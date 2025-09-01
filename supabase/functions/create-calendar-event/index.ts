import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = 'https://ytgalgzikozeumomflhp.supabase.co'
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface GoogleCalendarEvent {
  summary: string
  description?: string
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: string
  reminders: {
    useDefault: boolean
  }
}

async function getValidAccessToken(userId: string): Promise<string> {
  const { data: user, error } = await supabase
    .from('users')
    .select('google_access_token, google_refresh_token')
    .eq('id', userId)
    .single()

  if (error || !user?.google_access_token) {
    throw new Error('No Google access token found. Please connect your Google Calendar.')
  }

  // Test if the current token is valid
  const testResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
    headers: {
      Authorization: `Bearer ${user.google_access_token}`,
    },
  })

  if (testResponse.status === 401 && user.google_refresh_token) {
    // Token expired, refresh it
    console.log('Access token expired, refreshing...')
    
    const refreshResponse = await supabase.functions.invoke('google-auth/refresh', {
      body: { userId }
    })

    if (refreshResponse.error) {
      throw new Error('Failed to refresh Google access token')
    }

    const { access_token } = await refreshResponse.data
    return access_token
  }

  if (!testResponse.ok) {
    throw new Error('Invalid Google access token')
  }

  return user.google_access_token
}

async function createGoogleCalendarEvent(accessToken: string, event: GoogleCalendarEvent): Promise<any> {
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Calendar API error: ${response.status} ${error}`)
  }

  return response.json()
}

function buildGoogleEvent(draftEvent: any): GoogleCalendarEvent {
  const event: GoogleCalendarEvent = {
    summary: draftEvent.title || 'Event from Instagram',
    description: `Created from Instagram DM\n\n${draftEvent.notes || ''}`,
    start: {
      dateTime: draftEvent.start_dt,
      timeZone: 'UTC', // Will be converted based on location or user timezone
    },
    end: {
      dateTime: draftEvent.end_dt || new Date(new Date(draftEvent.start_dt).getTime() + 2 * 60 * 60 * 1000).toISOString(),
      timeZone: 'UTC',
    },
    reminders: {
      useDefault: true,
    },
  }

  if (draftEvent.location) {
    event.location = draftEvent.location
  }

  return event
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { userId, draftEventId } = await req.json()

    // Get the most recent draft event for this user if no specific ID provided
    let draftQuery = supabase
      .from('draft_events')
      .select('*')
      .eq('user_id', userId)

    if (draftEventId) {
      draftQuery = draftQuery.eq('id', draftEventId)
    } else {
      draftQuery = draftQuery
        .eq('needs_confirmation', false)
        .order('created_at', { ascending: false })
        .limit(1)
    }

    const { data: draftEvent, error: draftError } = await draftQuery.maybeSingle()

    if (draftError) {
      throw new Error(`Database error: ${draftError.message}`)
    }

    if (!draftEvent) {
      throw new Error('No draft event found')
    }

    if (!draftEvent.start_dt) {
      throw new Error('Event start time is required')
    }

    // Get valid access token
    const accessToken = await getValidAccessToken(userId)

    // Build Google Calendar event
    const googleEvent = buildGoogleEvent(draftEvent)
    
    console.log('Creating Google Calendar event:', googleEvent)

    // Create the event
    const calendarResponse = await createGoogleCalendarEvent(accessToken, googleEvent)

    // Save the event record
    const { data: eventRecord, error: eventError } = await supabase
      .from('events')
      .insert({
        user_id: userId,
        draft_event_id: draftEvent.id,
        google_event_id: calendarResponse.id,
        calendar_id: 'primary',
        request_payload: googleEvent,
        response_payload: calendarResponse,
      })
      .select('id')
      .single()

    if (eventError) {
      console.error('Error saving event record:', eventError)
      // Don't throw here as the calendar event was created successfully
    }

    // Mark draft as processed (no longer needs confirmation)
    await supabase
      .from('draft_events')
      .update({ needs_confirmation: false })
      .eq('id', draftEvent.id)

    console.log(`Successfully created calendar event: ${calendarResponse.htmlLink}`)

    return new Response(JSON.stringify({
      success: true,
      eventId: calendarResponse.id,
      eventLink: calendarResponse.htmlLink,
      title: draftEvent.title,
      startTime: draftEvent.start_dt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Calendar event creation error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})