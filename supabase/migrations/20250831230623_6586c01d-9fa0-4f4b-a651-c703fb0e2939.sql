-- Add missing RLS policies for user_roles table
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

CREATE POLICY "Admins can manage all user roles" 
ON public.user_roles 
FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users u 
        JOIN public.user_roles ur ON u.id = ur.user_id 
        WHERE u.auth_user_id = auth.uid() 
        AND ur.role = 'admin'
    )
);

CREATE POLICY "System can insert user roles" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (TRUE); -- Allow system to insert, will be handled by service role