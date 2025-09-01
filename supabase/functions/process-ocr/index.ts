import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = 'https://ytgalgzikozeumomflhp.supabase.co'
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface EventData {
  title?: string
  start_dt?: string
  end_dt?: string
  location?: string
  notes?: string
  confidence: number
}

// Simple OCR using a web service (placeholder - you'd use a real OCR service)
async function performOCR(imageUrl: string): Promise<string> {
  try {
    console.log('Performing OCR on:', imageUrl)
    
    // Download the image
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`)
    }
    
    // For now, return a placeholder - in real implementation you'd use:
    // - Tesseract.js in the browser
    // - Google Vision API
    // - AWS Textract
    // - Azure Computer Vision
    
    // Simulate OCR result for testing
    return `
    CLUB INFORMATION SESSION
    
    Join us for an exciting information session!
    
    Date: Friday, September 15th, 2024
    Time: 7:00 PM - 9:00 PM
    Location: Student Center Room 205
    
    Learn about:
    - Club activities and events
    - How to get involved
    - Networking opportunities
    
    Free pizza and drinks provided!
    
    Contact: club@university.edu
    Website: https://university.edu/club
    `
  } catch (error) {
    console.error('OCR error:', error)
    throw error
  }
}

function parseEventFromText(text: string): EventData {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  
  let title = ''
  let start_dt = ''
  let end_dt = ''
  let location = ''
  let notes = ''
  let confidence = 0.5

  // Extract title (usually first few prominent lines)
  const titleCandidates = lines.slice(0, 3).filter(line => 
    line.length > 5 && 
    !line.toLowerCase().includes('date') && 
    !line.toLowerCase().includes('time') &&
    !line.toLowerCase().includes('location')
  )
  
  if (titleCandidates.length > 0) {
    title = titleCandidates[0]
    confidence += 0.2
  }

  // Extract date and time
  const dateTimeRegexes = [
    /(?:date|when):\s*([^,\n]+)/i,
    /(?:time):\s*([^,\n]+)/i,
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+([^,\n]+)/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{1,2}:\d{2}\s*(?:am|pm))/i,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i
  ]

  let dateFound = false
  let timeFound = false
  
  for (const line of lines) {
    for (const regex of dateTimeRegexes) {
      const match = line.match(regex)
      if (match) {
        const matchedText = match[1] || match[0]
        
        // Try to parse as a complete datetime
        try {
          const parsedDate = new Date(matchedText)
          if (!isNaN(parsedDate.getTime())) {
            start_dt = parsedDate.toISOString()
            dateFound = true
            confidence += 0.3
          }
        } catch {
          // If parsing fails, store the raw text for manual processing
          if (!start_dt) {
            start_dt = matchedText
            dateFound = true
            confidence += 0.1
          }
        }
      }
    }
    
    // Extract time separately if found
    const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i)
    if (timeMatch && !timeFound) {
      timeFound = true
      confidence += 0.2
      
      // If we have a date but no time in start_dt, try to combine them
      if (start_dt && !start_dt.includes('T')) {
        try {
          const timeStr = timeMatch[1]
          const combinedDateTime = new Date(`${start_dt} ${timeStr}`)
          if (!isNaN(combinedDateTime.getTime())) {
            start_dt = combinedDateTime.toISOString()
          }
        } catch {
          // Keep separate if combination fails
        }
      }
    }
  }

  // Extract location
  const locationRegexes = [
    /(?:location|where|room|address):\s*([^,\n]+)/i,
    /(?:at|@)\s+([^,\n]+(?:room|center|building|hall|auditorium)[^,\n]*)/i,
    /(room\s+\d+[^,\n]*)/i,
    /([^,\n]*(?:center|building|hall|auditorium|library)[^,\n]*)/i
  ]

  for (const line of lines) {
    for (const regex of locationRegexes) {
      const match = line.match(regex)
      if (match && !location) {
        location = match[1].trim()
        confidence += 0.2
        break
      }
    }
  }

  // Extract additional notes (contact info, websites, etc.)
  const noteLines = []
  for (const line of lines) {
    if (line.includes('@') || line.includes('http') || line.includes('contact')) {
      noteLines.push(line)
    }
  }
  
  if (noteLines.length > 0) {
    notes = noteLines.join('\n')
    confidence += 0.1
  }

  // Set end time if not specified (default 2 hours)
  if (start_dt && start_dt.includes('T')) {
    try {
      const startDate = new Date(start_dt)
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000) // Add 2 hours
      end_dt = endDate.toISOString()
    } catch {
      // Keep empty if calculation fails
    }
  }

  // Ensure confidence doesn't exceed 1
  confidence = Math.min(confidence, 1.0)

  return {
    title: title || undefined,
    start_dt: start_dt || undefined,
    end_dt: end_dt || undefined,
    location: location || undefined,
    notes: notes || undefined,
    confidence
  }
}

async function createDraftEvent(userId: string, messageId: string, eventData: EventData, ocrText: string) {
  const { data, error } = await supabase
    .from('draft_events')
    .insert({
      user_id: userId,
      source_message_id: messageId,
      title: eventData.title,
      start_dt: eventData.start_dt,
      end_dt: eventData.end_dt,
      location: eventData.location,
      notes: eventData.notes,
      confidence: eventData.confidence,
      needs_confirmation: eventData.confidence < 0.8 || !eventData.start_dt || !eventData.title,
      ocr_text: ocrText
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating draft event:', error)
    throw error
  }

  return data.id
}

async function sendQuickReplies(userId: string, eventData: EventData) {
  // This would send Instagram quick replies to the user
  // For now, we'll just log what we would send
  console.log(`Would send quick replies to user ${userId}:`)
  
  if (!eventData.start_dt) {
    console.log('Quick reply: Ask for date/time')
  } else if (eventData.confidence < 0.8) {
    console.log(`Quick reply: Confirm event - ${eventData.title} on ${eventData.start_dt}`)
  } else {
    console.log('Auto-creating event due to high confidence')
    // Trigger calendar creation
    await supabase.functions.invoke('create-calendar-event', {
      body: { userId }
    })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { userId, messageId, mediaUrl } = await req.json()
    
    console.log(`Processing OCR for user ${userId}, message ${messageId}`)
    
    // Perform OCR
    const ocrText = await performOCR(mediaUrl)
    console.log('OCR result:', ocrText)
    
    // Parse event data
    const eventData = parseEventFromText(ocrText)
    console.log('Parsed event data:', eventData)
    
    // Create draft event
    const draftId = await createDraftEvent(userId, messageId, eventData, ocrText)
    console.log('Created draft event:', draftId)
    
    // Mark message as processed
    await supabase
      .from('messages')
      .update({ processed: true })
      .eq('id', messageId)
    
    // Send quick replies or auto-create event
    await sendQuickReplies(userId, eventData)
    
    return new Response(
      JSON.stringify({ success: true, draftId, confidence: eventData.confidence }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('OCR processing error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
