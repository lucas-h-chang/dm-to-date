import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { User } from '@supabase/supabase-js'
import { CalendarIcon, InstagramIcon, RefreshCw, ExternalLink } from 'lucide-react'

interface UserProfile {
  id: string
  ig_psid: string | null
  ig_username: string | null
  google_sub: string | null
  timezone: string
}

interface DraftEvent {
  id: string
  title: string | null
  start_dt: string | null
  end_dt: string | null
  location: string | null
  notes: string | null
  confidence: number
  needs_confirmation: boolean
  created_at: string
}

interface CalendarEvent {
  id: string
  google_event_id: string
  title: string
  start_time: string
  created_at: string
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [draftEvents, setDraftEvents] = useState<DraftEvent[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUserData()
  }, [])

  const loadUserData = async () => {
    try {
      setLoading(true)
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      
      if (!user) {
        // Redirect to auth page if not logged in
        window.location.href = '/auth'
        return
      }

      setUser(user)

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()

      if (profileError) {
        console.error('Profile error:', profileError)
      } else {
        setProfile(profile)
      }

      // Get draft events
      if (profile) {
        const { data: drafts, error: draftsError } = await supabase
          .from('draft_events')
          .select('*')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(10)

        if (draftsError) {
          console.error('Drafts error:', draftsError)
        } else {
          setDraftEvents(drafts || [])
        }

        // Get recent calendar events
        const { data: events, error: eventsError } = await supabase
          .from('events')
          .select(`
            id,
            google_event_id,
            created_at,
            draft_events!inner(title, start_dt)
          `)
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(10)

        if (eventsError) {
          console.error('Events error:', eventsError)
        } else {
          const formattedEvents = events?.map(event => ({
            id: event.id,
            google_event_id: event.google_event_id,
            title: (event as any).draft_events?.title || 'Untitled Event',
            start_time: (event as any).draft_events?.start_dt || '',
            created_at: event.created_at
          })) || []
          setCalendarEvents(formattedEvents)
        }
      }
    } catch (error) {
      console.error('Error loading data:', error)
      toast({
        title: 'Error',
        description: 'Failed to load dashboard data',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const connectGoogle = async () => {
    if (!profile) return

    try {
      const { data, error } = await supabase.functions.invoke('google-auth/auth', {
        body: { user_id: profile.id }
      })

      if (error) throw error

      // Open Google OAuth in a popup
      window.open(data.authUrl, 'google-auth', 'width=600,height=600')
      
      toast({
        title: 'Opening Google Authentication',
        description: 'Please complete the authentication in the popup window'
      })
    } catch (error) {
      console.error('Error connecting Google:', error)
      toast({
        title: 'Error',
        description: 'Failed to initiate Google connection',
        variant: 'destructive'
      })
    }
  }

  const approveEvent = async (draftId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('create-calendar-event', {
        body: { userId: profile?.id, draftEventId: draftId }
      })

      if (error) throw error

      toast({
        title: 'Event Created!',
        description: `Event has been added to your Google Calendar`,
      })

      // Reload data
      loadUserData()
    } catch (error) {
      console.error('Error creating event:', error)
      toast({
        title: 'Error',
        description: 'Failed to create calendar event',
        variant: 'destructive'
      })
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-96">
          <RefreshCw className="h-8 w-8 animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your Instagram to Calendar integration
          </p>
        </div>
        <Button onClick={loadUserData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <InstagramIcon className="h-5 w-5" />
              Instagram Connection
            </CardTitle>
            <CardDescription>
              Your Instagram account for receiving DMs
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profile?.ig_psid ? (
              <div className="space-y-2">
                <Badge variant="default">Connected</Badge>
                {profile.ig_username && (
                  <p className="text-sm text-muted-foreground">
                    Username: @{profile.ig_username}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  PSID: {profile.ig_psid}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Badge variant="secondary">Not Connected</Badge>
                <p className="text-sm text-muted-foreground">
                  Send a DM to your Instagram business account to connect
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Google Calendar
            </CardTitle>
            <CardDescription>
              Your Google Calendar for creating events
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profile?.google_sub ? (
              <div className="space-y-2">
                <Badge variant="default">Connected</Badge>
                <p className="text-sm text-muted-foreground">
                  Events will be created in your primary calendar
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Badge variant="secondary">Not Connected</Badge>
                <Button onClick={connectGoogle} size="sm">
                  Connect Google Calendar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Events */}
      {draftEvents.filter(e => e.needs_confirmation).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Events</CardTitle>
            <CardDescription>
              Events that need your confirmation before being added to your calendar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {draftEvents.filter(e => e.needs_confirmation).map((event) => (
                <div key={event.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h3 className="font-medium">
                        {event.title || 'Untitled Event'}
                      </h3>
                      {event.start_dt && (
                        <p className="text-sm text-muted-foreground">
                          {new Date(event.start_dt).toLocaleString()}
                        </p>
                      )}
                      {event.location && (
                        <p className="text-sm text-muted-foreground">
                          📍 {event.location}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline">
                      {Math.round(event.confidence * 100)}% confidence
                    </Badge>
                  </div>
                  
                  {event.notes && (
                    <p className="text-sm text-muted-foreground">
                      {event.notes}
                    </p>
                  )}
                  
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => approveEvent(event.id)}
                      size="sm"
                      disabled={!profile?.google_sub}
                    >
                      Create Event
                    </Button>
                    <Button variant="outline" size="sm">
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm">
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Calendar Events</CardTitle>
          <CardDescription>
            Events recently created from your Instagram DMs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {calendarEvents.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No events created yet. Send an event flyer to your Instagram account to get started!
            </p>
          ) : (
            <div className="space-y-3">
              {calendarEvents.map((event) => (
                <div key={event.id} className="flex justify-between items-center p-3 border rounded-lg">
                  <div>
                    <h3 className="font-medium">{event.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {event.start_time && new Date(event.start_time).toLocaleString()}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}