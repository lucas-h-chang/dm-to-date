import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = 'https://ytgalgzikozeumomflhp.supabase.co'
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const REDIRECT_URI = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-auth/callback`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const pathname = url.pathname

  // Handle authorization initiation
  if (pathname.endsWith('/auth') && req.method === 'GET') {
    const userId = url.searchParams.get('user_id')
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar')}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${userId}`

    return new Response(JSON.stringify({ authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Handle OAuth callback
  if (pathname.endsWith('/callback') && req.method === 'GET') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') // This is our user_id
    const error = url.searchParams.get('error')

    if (error) {
      return new Response(`
        <html>
          <body>
            <h1>Authentication Error</h1>
            <p>Error: ${error}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    if (!code || !state) {
      return new Response('Missing code or state parameter', { status: 400 })
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      })

      const tokens = await tokenResponse.json()

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokens.error}`)
      }

      // Get user info
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      })

      const userInfo = await userInfoResponse.json()

      // Store tokens in database (encrypted in production)
      const { error: updateError } = await supabase
        .from('users')
        .update({
          google_sub: userInfo.sub,
          google_access_token: tokens.access_token,
          google_refresh_token: tokens.refresh_token,
        })
        .eq('id', state)

      if (updateError) {
        console.error('Database update error:', updateError)
        throw updateError
      }

      return new Response(`
        <html>
          <body>
            <h1>Google Calendar Connected!</h1>
            <p>Your Google Calendar has been successfully connected.</p>
            <p>You can now send Instagram DMs with event flyers and they'll be automatically added to your calendar.</p>
            <p>You can close this window.</p>
            <script>
              // Try to close the window if it was opened as a popup
              if (window.opener) {
                window.close();
              }
            </script>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      })
    } catch (error) {
      console.error('OAuth callback error:', error)
      return new Response(`
        <html>
          <body>
            <h1>Authentication Error</h1>
            <p>Failed to connect Google Calendar: ${error.message}</p>
            <p>Please try again.</p>
          </body>
        </html>
      `, {
        status: 500,
        headers: { 'Content-Type': 'text/html' }
      })
    }
  }

  // Handle token refresh
  if (pathname.endsWith('/refresh') && req.method === 'POST') {
    try {
      const { userId } = await req.json()

      // Get current refresh token
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('google_refresh_token')
        .eq('id', userId)
        .single()

      if (userError || !user?.google_refresh_token) {
        throw new Error('No refresh token found')
      }

      // Refresh the access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: user.google_refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      const tokens = await tokenResponse.json()

      if (!tokenResponse.ok) {
        throw new Error(`Token refresh failed: ${tokens.error}`)
      }

      // Update the access token
      const { error: updateError } = await supabase
        .from('users')
        .update({
          google_access_token: tokens.access_token,
        })
        .eq('id', userId)

      if (updateError) {
        throw updateError
      }

      return new Response(JSON.stringify({ access_token: tokens.access_token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Token refresh error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response('Not found', { status: 404, headers: corsHeaders })
})