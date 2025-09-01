import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InstagramWebhookEntry {
  id: string
  messaging: InstagramMessage[]
}

interface InstagramMessage {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    attachments?: Array<{
      type: string
      payload: {
        url?: string
        sticker_id?: number
      }
    }>
    quick_reply?: {
      payload: string
    }
  }
  postback?: {
    payload: string
  }
}

interface NormalizedMessage {
  sender_id: string
  page_id: string
  timestamp: number
  message: {
    id: string
    type: 'image' | 'share_preview' | 'text' | 'link'
    text?: string
    media_url?: string
    quick_reply_payload?: string
  }
}

const supabaseUrl = 'https://ytgalgzikozeumomflhp.supabase.co'
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const VERIFY_TOKEN = Deno.env.get('INSTAGRAM_VERIFY_TOKEN')

function normalizeMessage(msg: InstagramMessage, pageId: string): NormalizedMessage {
  const normalized: NormalizedMessage = {
    sender_id: msg.sender.id,
    page_id: pageId,
    timestamp: msg.timestamp,
    message: {
      id: msg.message?.mid || `${msg.timestamp}_${msg.sender.id}`,
      type: 'text',
      text: msg.message?.text,
      quick_reply_payload: msg.message?.quick_reply?.payload || msg.postback?.payload
    }
  }

  // Handle attachments
  if (msg.message?.attachments?.length) {
    const attachment = msg.message.attachments[0]
    if (attachment.type === 'image' && attachment.payload.url) {
      normalized.message.type = 'image'
      normalized.message.media_url = attachment.payload.url
    }
  }

  // Handle shared posts (they come as attachments with specific structure)
  if (msg.message?.text?.includes('instagram.com/p/')) {
    normalized.message.type = 'share_preview'
    // Extract Instagram URL for potential oEmbed processing
    const urlMatch = msg.message.text.match(/https:\/\/[^\s]+/)
    if (urlMatch) {
      normalized.message.media_url = urlMatch[0]
    }
  }

  return normalized
}

async function upsertUser(igPsid: string): Promise<string> {
  // Try to find existing user by Instagram PSID
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('ig_psid', igPsid)
    .maybeSingle()

  if (existingUser) {
    // Update last_seen
    await supabase
      .from('users')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', existingUser.id)
    
    return existingUser.id
  }

  // Create new user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      ig_psid: igPsid,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString()
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating user:', error)
    throw error
  }

  return newUser.id
}

async function saveMessage(userId: string, normalizedMsg: NormalizedMessage): Promise<string> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      user_id: userId,
      platform_msg_id: normalizedMsg.message.id,
      type: normalizedMsg.message.type,
      text: normalizedMsg.message.text,
      media_url: normalizedMsg.message.media_url,
      received_at: new Date(normalizedMsg.timestamp).toISOString(),
      raw_json: normalizedMsg
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error saving message:', error)
    throw error
  }

  return data.id
}

async function triggerOCRProcessing(userId: string, messageId: string, mediaUrl: string) {
  // Trigger OCR processing (we'll implement the actual OCR in a separate function)
  console.log(`Triggering OCR for user ${userId}, message ${messageId}, media: ${mediaUrl}`)
  
  // For now, we'll call the OCR function directly
  // In production, you'd use a queue system
  try {
    await supabase.functions.invoke('process-ocr', {
      body: { userId, messageId, mediaUrl }
    })
  } catch (error) {
    console.error('Error triggering OCR:', error)
  }
}

async function handleQuickReply(userId: string, payload: string) {
  console.log(`Handling quick reply for user ${userId}: ${payload}`)
  
  // Parse quick reply payload
  if (payload.startsWith('CONFIRM_DATE:')) {
    const dateStr = payload.replace('CONFIRM_DATE:', '')
    // Update draft event with confirmed date
    await supabase.functions.invoke('update-draft-event', {
      body: { userId, action: 'confirm_date', value: dateStr }
    })
  } else if (payload === 'SAVE') {
    // Create calendar event from current draft
    await supabase.functions.invoke('create-calendar-event', {
      body: { userId }
    })
  } else if (payload === 'CANCEL') {
    // Cancel current draft
    await supabase.functions.invoke('update-draft-event', {
      body: { userId, action: 'cancel' }
    })
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)

  // Handle webhook verification (GET request)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified')
      return new Response(challenge, { status: 200 })
    } else {
      console.log('Webhook verification failed')
      return new Response('Forbidden', { status: 403 })
    }
  }

  // Handle webhook events (POST request)
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      console.log('Received webhook:', JSON.stringify(body, null, 2))

      // Log webhook for debugging
      await supabase
        .from('webhook_logs')
        .insert({
          source: 'instagram',
          event_type: 'message',
          payload: body
        })

      // Process each entry
      for (const entry of body.entry) {
        if (entry.messaging) {
          for (const msg of entry.messaging) {
            try {
              // Normalize message
              const normalizedMsg = normalizeMessage(msg, entry.id)
              
              // Upsert user
              const userId = await upsertUser(normalizedMsg.sender_id)
              
              // Save message
              const messageId = await saveMessage(userId, normalizedMsg)
              
              // Handle quick reply if present
              if (normalizedMsg.message.quick_reply_payload) {
                await handleQuickReply(userId, normalizedMsg.message.quick_reply_payload)
                continue
              }

              // Route message for processing
              if (normalizedMsg.message.media_url && 
                  (normalizedMsg.message.type === 'image' || normalizedMsg.message.type === 'share_preview')) {
                await triggerOCRProcessing(userId, messageId, normalizedMsg.message.media_url)
              } else if (normalizedMsg.message.text) {
                // Handle text-only messages (could contain event info)
                await supabase.functions.invoke('process-text', {
                  body: { userId, messageId, text: normalizedMsg.message.text }
                })
              }
            } catch (error) {
              console.error('Error processing message:', error)
            }
          }
        }
      }

      return new Response('OK', { status: 200, headers: corsHeaders })
    } catch (error) {
      console.error('Webhook error:', error)
      return new Response('Internal Server Error', { status: 500, headers: corsHeaders })
    }
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders })
})