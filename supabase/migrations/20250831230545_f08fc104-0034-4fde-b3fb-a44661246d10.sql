-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create enum for message types
CREATE TYPE public.message_type AS ENUM ('text', 'image', 'share_preview', 'link');

-- Create users table for app users (not auth.users)
CREATE TABLE public.users (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    ig_psid TEXT UNIQUE, -- Instagram Page-Scoped ID
    ig_username TEXT,
    google_sub TEXT,
    google_access_token TEXT, -- Will be encrypted
    google_refresh_token TEXT, -- Will be encrypted
    timezone TEXT DEFAULT 'UTC', -- IANA timezone
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user roles table
CREATE TABLE public.user_roles (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- Create messages table
CREATE TABLE public.messages (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    platform_msg_id TEXT NOT NULL,
    type message_type NOT NULL,
    text TEXT,
    media_url TEXT, -- Ephemeral URL, download immediately
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_json JSONB,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create draft events table
CREATE TABLE public.draft_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    source_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
    title TEXT,
    start_dt TIMESTAMP WITH TIME ZONE,
    end_dt TIMESTAMP WITH TIME ZONE,
    location TEXT,
    notes TEXT,
    confidence FLOAT DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    needs_confirmation BOOLEAN DEFAULT TRUE,
    ocr_text TEXT, -- Store extracted OCR text
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create events table for successfully created calendar events
CREATE TABLE public.events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    draft_event_id UUID REFERENCES public.draft_events(id) ON DELETE SET NULL,
    google_event_id TEXT NOT NULL,
    calendar_id TEXT DEFAULT 'primary',
    request_payload JSONB,
    response_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create webhook logs table for debugging
CREATE TABLE public.webhook_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    source TEXT NOT NULL, -- 'instagram', 'google', etc.
    event_type TEXT,
    payload JSONB,
    processed BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role = _role
    )
$$;

-- Create RLS policies for users table
CREATE POLICY "Users can view their own profile" 
ON public.users 
FOR SELECT 
USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can update their own profile" 
ON public.users 
FOR UPDATE 
USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.users 
FOR INSERT 
WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Admins can view all users" 
ON public.users 
FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users u 
        JOIN public.user_roles ur ON u.id = ur.user_id 
        WHERE u.auth_user_id = auth.uid() 
        AND ur.role = 'admin'
    )
);

-- Create RLS policies for messages (users can only see their own)
CREATE POLICY "Users can view their own messages" 
ON public.messages 
FOR SELECT 
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

CREATE POLICY "System can insert messages" 
ON public.messages 
FOR INSERT 
WITH CHECK (TRUE); -- Allow system to insert, will be handled by service role

-- Create RLS policies for draft events
CREATE POLICY "Users can view their own draft events" 
ON public.draft_events 
FOR ALL 
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

-- Create RLS policies for events
CREATE POLICY "Users can view their own events" 
ON public.events 
FOR ALL 
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

-- Create RLS policies for webhook logs (admin only)
CREATE POLICY "Admins can view webhook logs" 
ON public.webhook_logs 
FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users u 
        JOIN public.user_roles ur ON u.id = ur.user_id 
        WHERE u.auth_user_id = auth.uid() 
        AND ur.role = 'admin'
    )
);

-- Create indexes for performance
CREATE INDEX idx_users_ig_psid ON public.users(ig_psid);
CREATE INDEX idx_users_auth_user_id ON public.users(auth_user_id);
CREATE INDEX idx_messages_user_id ON public.messages(user_id);
CREATE INDEX idx_messages_platform_msg_id ON public.messages(platform_msg_id);
CREATE INDEX idx_messages_processed ON public.messages(processed);
CREATE INDEX idx_draft_events_user_id ON public.draft_events(user_id);
CREATE INDEX idx_draft_events_needs_confirmation ON public.draft_events(needs_confirmation);
CREATE INDEX idx_events_user_id ON public.events(user_id);
CREATE INDEX idx_events_google_event_id ON public.events(google_event_id);
CREATE INDEX idx_webhook_logs_processed ON public.webhook_logs(processed);
CREATE INDEX idx_webhook_logs_source ON public.webhook_logs(source);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_draft_events_updated_at
    BEFORE UPDATE ON public.draft_events
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (auth_user_id)
    VALUES (NEW.id);
    
    -- Give new users the 'user' role by default
    INSERT INTO public.user_roles (user_id, role)
    SELECT id, 'user'
    FROM public.users
    WHERE auth_user_id = NEW.id;
    
    RETURN NEW;
END;
$$;

-- Create trigger to automatically create user profile on auth.users insert
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();