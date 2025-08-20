/**
 * Voice Command Processing Functions - Unified Firebase Auth Version
 * Firebase Functions v2 implementation with OpenAI Assistant API and unified Google authentication
 */

import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { google } from "googleapis";
import OpenAI from "openai";

// Initialize Firebase Admin SDK for server-side operations
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Initialize Firebase Admin (only needs to be done once)
initializeApp();

// Get Firestore instance for the default database
const customDb = getFirestore();

// OpenAI API configuration
const OPENAI_API_KEY2 = defineSecret("OPENAI_API_KEY2");

// Initialize OpenAI client (will be initialized with API key when needed)
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        if (!OPENAI_API_KEY2.value()) {
            throw new Error('OpenAI API key not configured');
        }
        openaiClient = new OpenAI({
            apiKey: OPENAI_API_KEY2.value()
        });
    }
    return openaiClient;
}

// Google OAuth client credentials removed - iOS app now manages tokens directly

// App ID for consistent document paths
const APP_ID = "my-voice-calendly-app";

// Define TypeScript interfaces for our data structures  
// @ts-ignore - Used in function signatures
interface AppointmentData {
    id?: string;
    title: string;
    date: string;
    time: string | null;  // Allow null for all-day events
    duration?: number | null;
    attendees?: string[];
    timestamp?: Date;
    status?: string;
    createdAt?: FieldValue;
    googleCalendarEventId?: string | null;
    calendarSynced?: boolean;
    calendarSyncError?: string;
    meetingLink?: string | null;
    location?: string | null;
    description?: string | null;
    type?: string;
}

// OpenAI Assistant Function Tools Definitions
const CALENDAR_FUNCTION_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "track_partial_appointment",
            description: "Track partial appointment information while gathering missing details",
            parameters: {
                type: "object",
                properties: {
                    event_type: {
                        type: "string",
                        enum: ["personal", "meeting"],
                        description: "Type of event being scheduled"
                    },
                    partial_data: {
                        type: "object",
                        description: "Partial appointment data collected so far"
                    },
                    missing_fields: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of required fields still missing"
                    },
                    next_question: {
                        type: "string",
                        description: "The question to ask the user for missing information"
                    }
                },
                required: ["event_type", "partial_data", "missing_fields"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "preview_appointments_for_cancellation",
            description: "Show appointments that will be cancelled and request confirmation before bulk deletion",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format"
                    },
                    appointments_to_cancel: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                time: { type: "string" },
                                attendees: { 
                                    type: "array",
                                    items: { type: "string" }
                                }
                            }
                        },
                        description: "List of appointments that will be cancelled"
                    },
                    cancellation_type: {
                        type: "string",
                        enum: ["all", "specific"],
                        description: "Whether cancelling all appointments or specific ones"
                    }
                },
                required: ["date", "appointments_to_cancel", "cancellation_type"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "schedule_appointment",
            description: "Schedule a business appointment or meeting with other people",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Meeting title (e.g., 'Project Review', 'Call with Sarah')"
                    },
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format (e.g., '2025-07-25')"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (e.g., '14:30')"
                    },
                    duration: {
                        type: "number",
                        description: "Duration in minutes (e.g., 30, 60)"
                    },
                    attendees: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of attendee names (e.g., ['John', 'Sarah', 'Mike'])"
                    },
                    meeting_platform: {
                        type: "string",
                        description: "Meeting platform like 'Google Meet', 'Zoom', or 'In Person'"
                    }
                },
                required: ["date", "time"] // Reduced required fields - duration will default to 30
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "create_personal_event",
            description: "Create a personal event, reminder, or activity (not involving other people)",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Event title (e.g., 'Gym Session', 'Dentist Appointment', 'Go to Park')"
                    },
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (optional for all-day events)"
                    },
                    duration: {
                        type: "number",
                        description: "Duration in minutes (optional)"
                    },
                    location: {
                        type: "string",
                        description: "Location or address"
                    },
                    description: {
                        type: "string",
                        description: "Additional notes or description"
                    },
                    is_all_day: {
                        type: "boolean",
                        description: "Whether this is an all-day event/reminder"
                    }
                },
                required: ["title", "date"] // Time is optional for all-day events
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "cancel_appointment",
            description: "Cancel or delete an existing appointment or event",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Appointment title or partial match"
                    },
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (optional)"
                    },
                    attendees: {
                        type: "array",
                        items: { type: "string" },
                        description: "Attendee names to help identify the appointment"
                    }
                },
                required: ["date"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "cancel_all_appointments_for_date",
            description: "Efficiently cancel ALL appointments/events/meetings/calendar items for a specific date in one operation. Use when user says: cancel all events, delete all appointments, clear schedule, remove everything, etc. for any date.",
            parameters: {
                type: "object",
                properties: {
                    start_date: {
                        type: "string",
                        description: "Start date in YYYY-MM-DD format"
                    },
                    end_date: {
                        type: "string",
                        description: "End date in YYYY-MM-DD format (optional, defaults to start_date)"
                    }
                },
                required: ["start_date"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_appointments",
            description: "Retrieve appointments and events for a specific date or date range",
            parameters: {
                type: "object",
                properties: {
                    start_date: {
                        type: "string",
                        description: "Start date in YYYY-MM-DD format"
                    },
                    end_date: {
                        type: "string",
                        description: "End date in YYYY-MM-DD format (optional, defaults to start_date)"
                    }
                },
                required: ["start_date"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "set_availability",
            description: "Set user's general availability schedule for the week",
            parameters: {
                type: "object",
                properties: {
                    monday: {
                        type: "object",
                        properties: {
                            start: { type: "string", description: "Start time in HH:MM format" },
                            end: { type: "string", description: "End time in HH:MM format" }
                        }
                    },
                    tuesday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    },
                    wednesday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    },
                    thursday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    },
                    friday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    },
                    saturday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    },
                    sunday: {
                        type: "object",
                        properties: {
                            start: { type: "string" },
                            end: { type: "string" }
                        }
                    }
                }
            }
        }
    }
];

/**
 * Get assistant instructions with current date
 */
function getAssistantInstructions(today: string, timezone: string = 'UTC'): string {
    return `You are a helpful and intelligent voice calendar assistant. Your role is to help users manage their calendar through natural conversation.

**🚨 CRITICAL RULE #1 🚨**
If user says "cancel all [events/appointments/meetings] for [any date]":
→ IMMEDIATELY use cancel_all_appointments_for_date
→ DO NOT use get_appointments
→ DO NOT use multiple cancel_appointment calls
→ This is the MOST IMPORTANT RULE

Today's date is ${today} (in timezone: ${timezone}). Use this as reference for relative dates like "tomorrow", "next week", etc. IMPORTANT: All relative date calculations must be based on this date in the user's timezone.

**IMPORTANT Vocabulary Understanding:**
These terms are SYNONYMS and mean the SAME thing - treat them identically:
- "appointments" = "events" = "meetings" = "calendar items" = "schedule"
- "cancel" = "delete" = "remove" = "clear"
- "all" = "everything" = "entire"

Examples that mean the same thing:
- "cancel all events" = "cancel all appointments"
- "clear my schedule" = "delete all appointments"
- "remove everything" = "cancel all events"

**Conversation Style:**
- Be conversational, friendly, and helpful
- Progressively gather missing information through natural questions
- Confirm important actions before executing them
- Remember context from previous messages in the conversation

**Key Capabilities:**
1. **Schedule Appointments:** Business meetings with other people
2. **Create Personal Events:** Personal activities, reminders, gym sessions, appointments
3. **Cancel Events:** Remove or delete existing calendar items  
4. **View Calendar:** Show upcoming appointments and events
5. **Set Availability:** Configure weekly availability schedule

**Bulk Cancellation - OPTIMIZED:**
When user wants to cancel/delete/clear/remove ALL appointments/events/meetings for a date, ALWAYS use cancel_all_appointments_for_date.

Examples that MUST trigger cancel_all_appointments_for_date:
- "cancel all events for tomorrow"
- "cancel all events for 18th of August"
- "cancel all appointments for August 26"
- "delete all events on Monday"
- "clear my schedule for Friday"
- "remove everything for the 26th"
- "cancel everything tomorrow"
- "delete all meetings on August 26"
- "clear all events for next Tuesday"
- ANY phrase with "cancel/delete/remove/clear" + "all/everything" + "events/appointments/meetings" + a date

How to handle:
1. Use cancel_all_appointments_for_date directly - this is a single efficient operation
2. No need to call get_appointments first
3. No need for confirmation - the function handles everything
4. The function will return how many items were cancelled

For SPECIFIC cancellation (with title, time, or attendees):
- Use the regular cancel_appointment function

**CRITICAL**: If the user says "all" or "everything" with any synonym of cancel/delete/remove and events/appointments/meetings, ALWAYS use cancel_all_appointments_for_date.

**⚠️ WARNING - NEVER DO THIS ⚠️**:
- NEVER call cancel_appointment multiple times for bulk cancellation
- NEVER call get_appointments followed by multiple cancel_appointment calls
- If the user wants to cancel ALL items for a date, you MUST use cancel_all_appointments_for_date
- Using multiple cancel_appointment calls will cause TIMEOUTS and is FORBIDDEN
- Even if you find multiple appointments, DO NOT cancel them one by one

**✅ ALWAYS DO THIS ✅**:
- For "cancel all [events/appointments/meetings] for [date]" → Use cancel_all_appointments_for_date ONLY
- This is ONE function call that handles everything efficiently
- It returns how many items were cancelled

**Confirmation Context:**
- If user previously saw a confirmation request and responds with "yes", "confirm", "go ahead", check if there's a pending bulk cancellation
- If there is a pending operation, execute it
- Clear context after execution or denial

**Smart Context Detection:**
- Personal events (doctor, dentist, gym, workout, personal appointment): Use create_personal_event
- Business meetings (meeting, call, sync, review, with [person]): Use schedule_appointment
- Recognize when participants are NOT needed (personal events)

**Attendee Handling:**
- Accept attendee names in the attendees field (e.g., "John", "Sarah", "Mike")
- Simply store the names as provided by the user
- Names will be included in the appointment details and event description
- No need to collect email addresses

**Progressive Sync System:**

TIER 1 - Save Locally (Date Required):
- As soon as you have a date, create the appointment
- Message: "📱 Saved locally. What time to sync with Google Calendar?"

TIER 2 - Auto Sync (Date + Time):
- Automatically sync to Google Calendar when both date and time are known
- Message: "✅ Added to Google Calendar"

**Simplified Rules:**
1. DATE IS KING - Only date is truly required
2. Create appointment immediately when date is known
3. Ask maximum 2 questions then stop
4. Accept vague inputs: "morning" = 9 AM, "afternoon" = 2 PM, "evening" = 6 PM
5. Use the ENTIRE user input as title if unclear

**Resilience:**
- NEVER fail to create something
- If input is unclear, use it as the title: "asdfgh" → title: "asdfgh"
- Default missing times to null (all-day event)
- Default duration to 30 min for meetings, 60 min for personal events

**Smart Defaults and Suggestions:**
- No time specified → Ask if all-day event or suggest common times
- No duration → Use smart defaults based on event type
- No title → Generate from context
- Morning = 9:00 AM, Afternoon = 2:00 PM, Evening = 6:00 PM

**Handling Incomplete Requests:**
1. Identify event type from context
2. Collect available information
3. Ask ONLY for missing REQUIRED fields
4. Suggest defaults for optional fields
5. Summarize and confirm before creating

**Example Flows:**
User: "Visit friend Dustin tomorrow"
You: "📱 I've saved 'Visit friend Dustin' for tomorrow. What time to add to Google Calendar?"
User: "2 PM"
You: "✅ Visit friend Dustin tomorrow at 2 PM added to Google Calendar"

User: "Meeting with Sarah"  
You: "📝 What day should I schedule this meeting with Sarah?"
User: "Friday afternoon"
You: "✅ Meeting with Sarah on Friday at 2 PM added to Google Calendar"

User: "Schedule a meeting with John and Mike tomorrow at 3pm"
You: "✅ Meeting with John and Mike scheduled for tomorrow at 3 PM added to Google Calendar"

User: "Doctor next week"
You: "📱 Doctor appointment saved for next week. What day and time works best?"
User: "Tuesday 10 AM"
You: "✅ Doctor appointment Tuesday at 10 AM added to Google Calendar"

**Important:** 
- Use function tools to perform actual calendar operations
- Be proactive in gathering missing information
- Don't assume - ask when uncertain
- Keep track of partial information throughout the conversation
- Always confirm the complete details before creating the event

**Context Persistence:**
- If a conversation was interrupted, acknowledge what was already collected
- Use the track_partial_appointment function to store collected data
- When resuming, remind the user what information you already have
- Example: "I see we were scheduling a doctor's appointment for tomorrow. What time works best?"`;
}

/**
 * Get or create OpenAI Assistant for the voice calendar
 */
async function getOrCreateAssistant(timezone: string = 'UTC'): Promise<string> {
    const openai = getOpenAIClient();
    
    try {
        // FORCE RECREATION: Delete existing assistant to ensure new tools and instructions are used
        // This prevents cached behavior patterns from old assistant
        const configDoc = await customDb.collection('config').doc('assistant').get();
        
        if (configDoc.exists) {
            const assistantId = configDoc.data()?.assistantId;
            const lastModel = configDoc.data()?.model;
            
            // Check if we need to recreate due to wrong model
            if (lastModel && lastModel !== "gpt-4o-mini") {
                logger.warn(`⚠️ WRONG MODEL DETECTED: ${lastModel}. Forcing recreation with gpt-4o-mini`);
                // Delete the old assistant
                if (assistantId) {
                    try {
                        await openai.beta.assistants.del(assistantId);
                        logger.info(`Deleted old assistant ${assistantId} that was using expensive model ${lastModel}`);
                    } catch (error) {
                        logger.warn(`Could not delete old assistant: ${error}`);
                    }
                }
            } else if (assistantId) {
                // Verify the assistant still exists and check its model
                try {
                    const assistant = await openai.beta.assistants.retrieve(assistantId);
                    logger.info(`Found existing assistant: ${assistantId}, model: ${assistant.model}`);
                    
                    // CRITICAL: Verify it's using the cheap model
                    if (assistant.model !== "gpt-4o-mini") {
                        logger.error(`⚠️ EXPENSIVE MODEL DETECTED: ${assistant.model}. Deleting and recreating...`);
                        await openai.beta.assistants.del(assistantId);
                    } else {
                        // Update the assistant with new instructions and tools
                        const today = getCurrentDateInTimezone(timezone);
                        const instructions = getAssistantInstructions(today, timezone);
                        
                        await openai.beta.assistants.update(assistantId, {
                            instructions: instructions,
                            tools: CALENDAR_FUNCTION_TOOLS,
                            model: "gpt-4o-mini" // Force the model again
                        });
                        
                        logger.info(`✅ Updated assistant ${assistantId} - confirmed using gpt-4o-mini (cheap model)`);
                        return assistantId;
                    }
                } catch (error) {
                    logger.warn(`Stored assistant ${assistantId} not found or couldn't be updated, creating new one`);
                }
            }
        }
        
        // Create new assistant if none exists or stored one is invalid
        logger.info('Creating new OpenAI Assistant');
        
        const today = getCurrentDateInTimezone(timezone);
        const instructions = getAssistantInstructions(today, timezone);

        const assistant = await openai.beta.assistants.create({
            name: "Voice Calendar Assistant",
            instructions: instructions,
            model: "gpt-4o-mini",
            tools: CALENDAR_FUNCTION_TOOLS
        });

        logger.info(`✅ Created new OpenAI Assistant: ${assistant.id} with model: ${assistant.model}`);
        
        // CRITICAL: Verify the model is correct
        if (assistant.model !== "gpt-4o-mini") {
            logger.error(`⚠️⚠️⚠️ CRITICAL: Assistant created with WRONG MODEL: ${assistant.model}`);
            logger.error(`Expected gpt-4o-mini but got ${assistant.model} - this will be EXPENSIVE!`);
            // Try to delete and throw error
            await openai.beta.assistants.del(assistant.id);
            throw new Error(`Assistant created with wrong model: ${assistant.model}. Deleted to prevent high costs.`);
        }
        
        // Store the assistant ID for future use
        await customDb.collection('config').doc('assistant').set({
            assistantId: assistant.id,
            createdAt: FieldValue.serverTimestamp(),
            model: assistant.model // Store actual model used
        });
        
        logger.info(`✅ Stored assistant ID in Firestore: ${assistant.id} (model: ${assistant.model})`);
        return assistant.id;
        
    } catch (error) {
        logger.error("Error creating or retrieving OpenAI Assistant:", error);
        throw new Error(`Failed to get assistant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get or create conversation thread for a user
 */
async function getOrCreateThread(userId: string): Promise<string> {
    const openai = getOpenAIClient();

    try {
        // Check if user has an existing active thread
        const userDoc = await customDb.collection('users').doc(userId).get();
        const userData = userDoc.data();

        if (userData?.activeThreadId) {
            // Try to retrieve the existing thread to ensure it's still valid
            try {
                await openai.beta.threads.retrieve(userData.activeThreadId);
                logger.info(`Using existing thread for user ${userId}: ${userData.activeThreadId}`);
                return userData.activeThreadId;
            } catch (error) {
                logger.warn(`Existing thread ${userData.activeThreadId} not found, creating new one`);
            }
        }

        // Create new thread
        const thread = await openai.beta.threads.create();

        // Store thread ID in user document
        await customDb.collection('users').doc(userId).update({
            activeThreadId: thread.id,
            threadCreatedAt: FieldValue.serverTimestamp()
        });

        logger.info(`Created new thread for user ${userId}: ${thread.id}`);
        return thread.id;
    } catch (error) {
        logger.error(`Error getting/creating thread for user ${userId}:`, error);
        throw new Error(`Failed to manage conversation thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Validate Firebase Auth user
 */
function validateUserAuth(auth: any): string {
    if (!auth || !auth.uid) {
        logger.error('User authentication failed');
        throw new Error('User must be authenticated to use this function.');
    }
    return auth.uid;
}

/**
 * Validate command text
 */
function validateCommand(command: any): string {
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
        logger.error('Invalid command received:', command);
        throw new Error('The command text is missing or invalid.');
    }
    return command.trim();
}

/**
 * Get an authenticated Google OAuth2 client using provided token
 */
// @ts-ignore - Will be used by calendar functions
async function getGoogleOAuth2Client(userId: string, accessToken: string) {
    try {
        logger.info(`Creating Google OAuth client for user: ${userId}`);

        if (!accessToken) {
            throw new Error('Google Calendar access token is required');
        }

        // Initialize OAuth2 client with minimal configuration
        const oAuth2Client = new google.auth.OAuth2();

        // Set the provided access token
        oAuth2Client.setCredentials({
            access_token: accessToken
        });

        logger.info(`Google OAuth client configured successfully for user: ${userId}`);
        return oAuth2Client;

    } catch (error) {
        logger.error('Error getting Google OAuth client:', error);
        throw new Error(`Failed to initialize Google Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Sync appointment to Google Calendar
 */
async function syncAppointmentToGoogleCalendar(userId: string, appointmentData: AppointmentData, accessToken: string): Promise<string | null> {
    try {
        logger.info(`Syncing appointment to Google Calendar for user ${userId}`);

        // Get Google OAuth client with provided token
        const oAuth2Client = await getGoogleOAuth2Client(userId, accessToken);

        // Initialize Google Calendar API
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        // Parse date and time
        const dateTimeString = `${appointmentData.date}T${appointmentData.time}:00`;
        const startTime = new Date(dateTimeString);

        // Calculate end time
        const endTime = new Date(startTime.getTime() + (appointmentData.duration || 30) * 60000);

        // Clean attendee names
        const cleanedAttendees = cleanAttendeeNames(appointmentData.attendees);
        
        // Build description including attendee names
        let description = appointmentData.description || '';
        
        if (cleanedAttendees.length > 0) {
            if (description) {
                description += '\n\n';
            }
            description += `Attendees: ${cleanedAttendees.join(', ')}`;
        }

        // Prepare event data - only include valid emails in attendees field
        const eventData: any = {
            summary: appointmentData.title,
            description: description || undefined,
            start: {
                dateTime: startTime.toISOString(),
                timeZone: 'UTC'
            },
            end: {
                dateTime: endTime.toISOString(),
                timeZone: 'UTC'
            },
            conferenceData: appointmentData.meetingLink?.includes('meet.google.com') ? {
                createRequest: {
                    requestId: appointmentData.id,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            } : undefined
        };
        
        // Note: Not adding attendees to Google Calendar since we're not collecting emails
        logger.info(`Creating Google Calendar event without email invites (attendees stored as names only)`);

        // Create the event
        const response = await calendar.events.insert({
            calendarId: 'primary',
            conferenceDataVersion: appointmentData.meetingLink?.includes('meet.google.com') ? 1 : 0,
            requestBody: eventData
        });

        logger.info(`Google Calendar event created: ${response.data?.id}`);
        return response.data?.id || null;

    } catch (error) {
        logger.error(`Error syncing to Google Calendar:`, error);
        throw error;
    }
}

/**
 * Sync personal event to Google Calendar
 */
async function syncPersonalEventToGoogleCalendar(userId: string, eventData: AppointmentData, accessToken: string): Promise<string | null> {
    try {
        logger.info(`Syncing personal event to Google Calendar for user ${userId}`);

        // Get Google OAuth client with provided token
        const oAuth2Client = await getGoogleOAuth2Client(userId, accessToken);

        // Initialize Google Calendar API
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        // Prepare event data for Google Calendar
        let googleEventData: any;

        // Check if this is an all-day event
        if (!eventData.time || eventData.time === '00:00') {
            // All-day event
            googleEventData = {
                summary: eventData.title,
                description: eventData.description,
                location: eventData.location,
                start: {
                    date: eventData.date,
                    timeZone: 'UTC'
                },
                end: {
                    date: eventData.date,
                    timeZone: 'UTC'
                }
            };
        } else {
            // Timed event
            const dateTimeString = `${eventData.date}T${eventData.time}:00`;
            const startTime = new Date(dateTimeString);
            const endTime = new Date(startTime.getTime() + (eventData.duration || 60) * 60000);

            googleEventData = {
                summary: eventData.title,
                description: eventData.description,
                location: eventData.location,
                start: {
                    dateTime: startTime.toISOString(),
                    timeZone: 'UTC'
                },
                end: {
                    dateTime: endTime.toISOString(),
                    timeZone: 'UTC'
                }
            };
        }

        // Create the event
        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: googleEventData
        });

        logger.info(`Google Calendar personal event created: ${response.data?.id}`);
        return response.data?.id || null;

    } catch (error) {
        logger.error(`Error syncing personal event to Google Calendar:`, error);
        throw error;
    }
}

/**
 * Cancel event in Google Calendar
 */
async function cancelGoogleCalendarEvent(userId: string, googleEventId: string, accessToken: string): Promise<void> {
    try {
        logger.info(`Cancelling Google Calendar event ${googleEventId} for user ${userId}`);

        // Get Google OAuth client with provided token
        const oAuth2Client = await getGoogleOAuth2Client(userId, accessToken);

        // Initialize Google Calendar API
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        // Delete the event
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: googleEventId
        });

        logger.info(`Google Calendar event ${googleEventId} cancelled successfully`);

    } catch (error) {
        logger.error(`Error cancelling Google Calendar event ${googleEventId}:`, error);
        throw error;
    }
}

/**
 * Bulk cancel multiple Google Calendar events efficiently
 */
async function bulkCancelGoogleCalendarEvents(userId: string, eventIds: string[], accessToken: string): Promise<{ successful: string[], failed: string[] }> {
    try {
        logger.info(`Bulk cancelling ${eventIds.length} Google Calendar events for user ${userId}`);

        if (eventIds.length === 0) {
            return { successful: [], failed: [] };
        }

        // Get Google OAuth client with provided token
        const oAuth2Client = await getGoogleOAuth2Client(userId, accessToken);

        // Initialize Google Calendar API
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        const successful: string[] = [];
        const failed: string[] = [];

        // Process deletions in parallel batches (max 10 at a time to avoid rate limits)
        const batchSize = 10;
        for (let i = 0; i < eventIds.length; i += batchSize) {
            const batch = eventIds.slice(i, i + batchSize);
            
            await Promise.all(
                batch.map(async (eventId) => {
                    try {
                        await calendar.events.delete({
                            calendarId: 'primary',
                            eventId: eventId
                        });
                        successful.push(eventId);
                        logger.info(`Successfully cancelled Google Calendar event: ${eventId}`);
                    } catch (error) {
                        failed.push(eventId);
                        logger.warn(`Failed to cancel Google Calendar event ${eventId}:`, error);
                    }
                })
            );
        }

        logger.info(`Bulk cancellation complete: ${successful.length} successful, ${failed.length} failed`);
        return { successful, failed };

    } catch (error) {
        logger.error(`Error in bulk Google Calendar cancellation:`, error);
        throw error;
    }
}

// Helper function to get partial appointment context
async function getPartialAppointmentContext(userId: string): Promise<any> {
    try {
        const partialDoc = await customDb
            .collection('users')
            .doc(userId)
            .collection('partialAppointments')
            .doc('current')
            .get();
        
        if (partialDoc.exists) {
            const data = partialDoc.data();
            logger.info(`Found partial appointment context for user ${userId}:`, data);
            return data;
        }
        
        return null;
    } catch (error) {
        logger.error(`Error retrieving partial appointment context for user ${userId}:`, error);
        return null;
    }
}

// Helper function to clear partial appointment data after successful creation
async function clearPartialAppointmentContext(userId: string): Promise<void> {
    try {
        await customDb
            .collection('users')
            .doc(userId)
            .collection('partialAppointments')
            .doc('current')
            .delete();
        
        logger.info(`Cleared partial appointment context for user ${userId}`);
    } catch (error) {
        logger.error(`Error clearing partial appointment context for user ${userId}:`, error);
    }
}

// Helper function to determine if event should be all-day
function isAllDayEvent(title: string): boolean {
    if (!title) return false;
    const allDayKeywords = ['birthday', 'holiday', 'anniversary', 'vacation', 'day off'];
    return allDayKeywords.some(keyword => 
        title.toLowerCase().includes(keyword)
    );
}

// Helper function to check if ready for Google Calendar sync
function isReadyForGoogleCalendar(appointment: any): boolean {
    // All-day events only need date
    if (isAllDayEvent(appointment.title)) {
        return !!appointment.date;
    }
    
    // Everything else needs both date and time
    return !!(appointment.date && appointment.time);
}

// Helper function to clean attendee names
function cleanAttendeeNames(attendees: string[] | undefined): string[] {
    if (!attendees || attendees.length === 0) {
        return [];
    }
    
    return attendees
        .map(attendee => attendee.trim())
        .filter(attendee => attendee.length > 0);
}

// Helper function to get current date in user's timezone
function getCurrentDateInTimezone(timezone: string): string {
    try {
        // Create a date formatter for the specific timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        const parts = formatter.formatToParts(new Date());
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const day = parts.find(p => p.type === 'day')?.value;
        
        // Return in YYYY-MM-DD format
        return `${year}-${month}-${day}`;
    } catch (error) {
        logger.warn(`Failed to get date for timezone ${timezone}, falling back to UTC:`, error);
        // Fallback to UTC if timezone is invalid
        return new Date().toISOString().slice(0, 10);
    }
}


// Helper function to get status message
function getStatusMessage(appointment: any): string {
    if (!appointment.date) {
        return "📝 What day should I schedule this?";
    } else if (!appointment.time && !isAllDayEvent(appointment.title)) {
        return "📱 Saved locally. What time to sync with Google Calendar?";
    } else if (appointment.googleCalendarEventId) {
        return "✅ In Google Calendar";
    } else if (isReadyForGoogleCalendar(appointment)) {
        return "⏳ Syncing to Google Calendar...";
    } else {
        return "📱 Saved locally";
    }
}

// Implementation for previewing appointments before bulk cancellation
async function previewAppointmentsForCancellation(userId: string, details: any): Promise<any> {
    try {
        logger.info(`Previewing appointments for cancellation for user ${userId}:`, details);
        
        const { date, appointments_to_cancel, cancellation_type } = details;
        
        // Store the pending cancellation in Firestore for later confirmation
        await customDb
            .collection('users')
            .doc(userId)
            .collection('pendingOperations')
            .doc('currentCancellation')
            .set({
                type: 'bulk_cancellation',
                date: date,
                appointments: appointments_to_cancel,
                cancellationType: cancellation_type,
                createdAt: FieldValue.serverTimestamp()
            }, { merge: true });
        
        logger.info(`Stored pending bulk cancellation for user ${userId}`);
        
        // Format the appointments list for display
        const appointmentsList = appointments_to_cancel.map((apt: any) => {
            let description = `• ${apt.title}`;
            if (apt.time && apt.time !== '00:00') {
                description += ` at ${apt.time}`;
            }
            if (apt.attendees && apt.attendees.length > 0) {
                description += ` with ${apt.attendees.join(', ')}`;
            }
            return description;
        }).join('\n');
        
        const response = {
            success: true,
            requiresConfirmation: true,
            operationType: 'bulk_cancellation',
            appointmentCount: appointments_to_cancel.length,
            date: date,
            appointmentsList: appointmentsList,
            message: `I found ${appointments_to_cancel.length} appointment${appointments_to_cancel.length > 1 ? 's' : ''} for ${date}:\n\n${appointmentsList}\n\nDo you want to cancel ${cancellation_type === 'all' ? 'all of them' : 'these appointments'}?`
        };
        
        logger.info(`Requesting confirmation for ${appointments_to_cancel.length} appointments`);
        return response;
        
    } catch (error) {
        logger.error(`Error previewing appointments for cancellation for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to preview appointments: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Implementation for tracking partial appointment data
async function trackPartialAppointment(userId: string, details: any): Promise<any> {
    try {
        logger.info(`Tracking partial appointment for user ${userId}:`, details);
        
        const { event_type, partial_data, missing_fields, next_question } = details;
        
        // Store partial data in Firestore for persistence
        await customDb
            .collection('users')
            .doc(userId)
            .collection('partialAppointments')
            .doc('current')
            .set({
                eventType: event_type,
                collectedData: partial_data,
                missingFields: missing_fields,
                lastUpdated: FieldValue.serverTimestamp()
            }, { merge: true });
        
        logger.info(`Stored partial appointment data for user ${userId}`);
        
        const response: any = {
            success: true,
            tracking: true,
            event_type,
            collected_data: partial_data,
            missing_fields,
            message: next_question || `I need a few more details to create your ${event_type === 'personal' ? 'personal event' : 'meeting'}.`,
            suggestions: [] as string[]
        };
        
        // Add smart suggestions based on missing fields
        if (missing_fields.includes('time')) {
            response.suggestions = ['9:00 AM', '2:00 PM', '3:00 PM', 'All-day event'];
        } else if (missing_fields.includes('date')) {
            response.suggestions = ['Today', 'Tomorrow', 'Next Monday', 'Next Friday'];
        } else if (missing_fields.includes('duration')) {
            response.suggestions = ['30 minutes', '1 hour', '2 hours'];
        }
        
        logger.info(`Partial appointment tracked, missing fields: ${missing_fields.join(', ')}`);
        return response;
        
    } catch (error) {
        logger.error(`Error tracking partial appointment for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to track appointment details: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Helper function to handle function calls from OpenAI Assistant
async function handleFunctionCall(functionName: string, functionArgs: any, userId: string, accessToken?: string): Promise<any> {
    logger.info(`Executing function: ${functionName} with args:`, JSON.stringify(functionArgs));

    try {
        switch (functionName) {
            case 'track_partial_appointment':
                return await trackPartialAppointment(userId, functionArgs);

            case 'preview_appointments_for_cancellation':
                return await previewAppointmentsForCancellation(userId, functionArgs);

            case 'schedule_appointment':
                return await scheduleAppointment(userId, functionArgs, accessToken);

            case 'create_personal_event':
                return await createPersonalEvent(userId, functionArgs, accessToken);

            case 'cancel_appointment':
                return await cancelAppointments(userId, functionArgs, accessToken);

            case 'cancel_all_appointments_for_date':
                return await cancelAllAppointmentsForDate(userId, functionArgs, accessToken);

            case 'get_appointments':
                return await getAppointments(userId, functionArgs, "Here are your appointments:");

            case 'set_availability':
                return await setAvailability(userId, functionArgs, "Your availability has been updated.");

            default:
                throw new Error(`Unknown function: ${functionName}`);
        }
    } catch (error) {
        logger.error(`Error executing function ${functionName}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            message: `Failed to execute ${functionName}: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

// Implementation for scheduling appointments
async function scheduleAppointment(userId: string, details: any, accessToken?: string): Promise<any> {
    try {
        logger.info(`Scheduling appointment for user ${userId}:`, details);

        // Only date is truly required - we can work with that
        if (!details.date) {
            return {
                success: false,
                message: '📝 What day should I schedule this meeting?',
                missing_fields: ['date'],
                partial_data: details
            };
        }

        // Generate appointment ID
        const appointmentId = customDb.collection('users').doc().id;

        // Prepare appointment data - handle all undefined fields
        const appointmentData: AppointmentData = {
            id: appointmentId,
            title: details.title || details.originalInput || 'Meeting',
            date: details.date,
            time: details.time || null,  // null for all-day or TBD
            duration: details.time ? (details.duration || 30) : null,  // Only set if has time
            attendees: cleanAttendeeNames(details.attendees),  // Store cleaned attendee names
            timestamp: new Date(),
            status: 'scheduled',
            createdAt: FieldValue.serverTimestamp(),
            googleCalendarEventId: null,
            calendarSynced: false,
            meetingLink: null,  // Initialize as null
            location: null,      // Initialize as null
            description: null    // Initialize as null
        };

        // Add meeting link if meeting platform is specified
        if (details.meeting_platform) {
            if (details.meeting_platform.toLowerCase().includes('google meet')) {
                appointmentData.meetingLink = 'https://meet.google.com/new';
            } else if (details.meeting_platform.toLowerCase().includes('zoom')) {
                appointmentData.meetingLink = 'https://zoom.us/j/placeholder';
            }
        }

        // Save to Firestore
        await customDb
            .collection('users')
            .doc(userId)
            .collection('appointments')
            .doc(appointmentId)
            .set(appointmentData);

        logger.info(`Appointment saved to Firestore for user ${userId}: ${appointmentId}`);
        
        // Log attendee info
        if (appointmentData.attendees && appointmentData.attendees.length > 0) {
            logger.info(`Attendees stored: ${appointmentData.attendees.join(', ')}`);
        }
        
        // Clear any partial appointment context after successful creation
        await clearPartialAppointmentContext(userId);

        // Only sync to Google Calendar if ready
        let statusMessage = getStatusMessage(appointmentData);
        
        if (isReadyForGoogleCalendar(appointmentData) && accessToken) {
            try {
                const googleEventId = await syncAppointmentToGoogleCalendar(userId, appointmentData, accessToken);
                if (googleEventId) {
                    // Update the appointment with Google Calendar event ID
                    await customDb
                        .collection('users')
                        .doc(userId)
                        .collection('appointments')
                        .doc(appointmentId)
                        .update({
                            googleCalendarEventId: googleEventId,
                            calendarSynced: true
                        });
                    appointmentData.googleCalendarEventId = googleEventId;
                    appointmentData.calendarSynced = true;
                    statusMessage = "✅ Added to Google Calendar";
                    logger.info(`Appointment synced to Google Calendar: ${googleEventId}`);
                }
            } catch (calendarError) {
                logger.warn(`Failed to sync appointment to Google Calendar:`, calendarError);
                await customDb
                    .collection('users')
                    .doc(userId)
                    .collection('appointments')
                    .doc(appointmentId)
                    .update({
                        calendarSyncError: calendarError instanceof Error ? calendarError.message : 'Unknown error'
                    });
                statusMessage = "📱 Saved locally (Google sync failed)";
            }
        }

        return {
            success: true,
            message: statusMessage,
            appointment: appointmentData
        };

    } catch (error) {
        logger.error(`Error scheduling appointment for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to schedule appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

async function createPersonalEvent(userId: string, details: any, accessToken?: string): Promise<any> {
    try {
        logger.info(`Creating personal event for user ${userId}:`, details);

        // Validate required fields - only date is truly required
        if (!details.date) {
            return {
                success: false,
                message: `📝 What day should I schedule this?`,
                missing_fields: ['date'],
                partial_data: details
            };
        }

        // Generate event ID
        const eventId = customDb.collection('users').doc().id;

        // Prepare event data - handle undefined fields properly
        const eventData: AppointmentData = {
            id: eventId,
            title: details.title || details.originalInput || "Personal Event",
            date: details.date,
            time: details.time || null, // Use null instead of '00:00' for all-day
            duration: details.time ? (details.duration || 60) : null, // Only set duration if has time
            location: details.location || null,  // Use null, not undefined
            description: details.description || null,  // Use null, not undefined
            type: 'personal_event',
            timestamp: new Date(),
            status: 'scheduled',
            createdAt: FieldValue.serverTimestamp(),
            googleCalendarEventId: null,
            calendarSynced: false
        };

        // Save to Firestore
        await customDb
            .collection('users')
            .doc(userId)
            .collection('appointments')
            .doc(eventId)
            .set(eventData);

        logger.info(`Personal event saved to Firestore for user ${userId}: ${eventId}`);
        
        // Clear any partial appointment context after successful creation
        await clearPartialAppointmentContext(userId);

        // Only sync to Google Calendar if ready
        let statusMessage = getStatusMessage(eventData);
        
        if (isReadyForGoogleCalendar(eventData) && accessToken) {
            try {
                const googleEventId = await syncPersonalEventToGoogleCalendar(userId, eventData, accessToken);
                if (googleEventId) {
                    // Update the event with Google Calendar event ID
                    await customDb
                        .collection('users')
                        .doc(userId)
                        .collection('appointments')
                        .doc(eventId)
                        .update({
                            googleCalendarEventId: googleEventId,
                            calendarSynced: true
                        });
                    eventData.googleCalendarEventId = googleEventId;
                    eventData.calendarSynced = true;
                    statusMessage = "✅ Added to Google Calendar";
                    logger.info(`Personal event synced to Google Calendar: ${googleEventId}`);
                }
            } catch (calendarError) {
                logger.warn(`Failed to sync personal event to Google Calendar:`, calendarError);
                await customDb
                    .collection('users')
                    .doc(userId)
                    .collection('appointments')
                    .doc(eventId)
                    .update({
                        calendarSyncError: calendarError instanceof Error ? calendarError.message : 'Unknown error'
                    });
                statusMessage = "📱 Saved locally (Google sync failed)";
            }
        }

        return {
            success: true,
            message: statusMessage,
            appointment: eventData
        };

    } catch (error) {
        logger.error(`Error creating personal event for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to create personal event: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

async function cancelAppointments(userId: string, details: any, accessToken?: string): Promise<any> {
    try {
        logger.info(`Cancelling appointments for user ${userId}:`, details);

        // Validate required fields
        if (!details.date) {
            throw new Error('Date is required for cancelling appointments');
        }

        // Query with proper index - efficient at scale
        let query = customDb
            .collection('users')
            .doc(userId)
            .collection('appointments')
            .where('date', '==', details.date)
            .where('status', '!=', 'cancelled');

        // Add additional filters if provided
        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            return {
                success: false,
                message: `No appointments found for ${details.date}`,
                error: 'No matching appointments found'
            };
        }

        let cancelledCount = 0;
        let calendarErrorCount = 0;
        const cancelledAppointments = [];

        // Filter appointments based on additional criteria
        for (const doc of querySnapshot.docs) {
            const appointment = doc.data() as AppointmentData;
            // No need to check status - query already excludes cancelled
            let shouldCancel = true;

            // Check title match if provided
            if (details.title) {
                const titleMatch = appointment.title.toLowerCase().includes(details.title.toLowerCase());
                if (!titleMatch) shouldCancel = false;
            }

            // Check time match if provided
            if (details.time && shouldCancel) {
                const timeMatch = appointment.time === details.time;
                if (!timeMatch) shouldCancel = false;
            }

            // Check attendees match if provided
            if (details.attendees && details.attendees.length > 0 && shouldCancel) {
                const attendeesMatch = details.attendees.some((attendee: string) =>
                    appointment.attendees?.some(a => a.toLowerCase().includes(attendee.toLowerCase()))
                );
                if (!attendeesMatch) shouldCancel = false;
            }

            if (shouldCancel) {
                // Update appointment status to cancelled
                await doc.ref.update({
                    status: 'cancelled',
                    cancelledAt: FieldValue.serverTimestamp()
                });

                // Try to cancel in Google Calendar
                try {
                    if (appointment.googleCalendarEventId && accessToken) {
                        await cancelGoogleCalendarEvent(userId, appointment.googleCalendarEventId, accessToken);
                        logger.info(`Cancelled Google Calendar event: ${appointment.googleCalendarEventId}`);
                    }
                } catch (calendarError) {
                    logger.warn(`Failed to cancel Google Calendar event:`, calendarError);
                    calendarErrorCount++;
                    // Update with calendar sync error but don't fail the entire operation
                    await doc.ref.update({
                        calendarSyncError: calendarError instanceof Error ? calendarError.message : 'Unknown error'
                    });
                }

                cancelledCount++;
                cancelledAppointments.push({
                    id: appointment.id,
                    title: appointment.title,
                    date: appointment.date,
                    time: appointment.time
                });
            }
        }

        if (cancelledCount === 0) {
            return {
                success: false,
                message: 'No matching appointments found to cancel',
                error: 'No appointments matched the cancellation criteria'
            };
        }

        const message = `Cancelled ${cancelledCount} appointment${cancelledCount > 1 ? 's' : ''}${calendarErrorCount > 0 ? ` (${calendarErrorCount} calendar sync errors)` : ''}`;

        return {
            success: true,
            message,
            cancelledCount,
            appointments: cancelledAppointments
        };

    } catch (error) {
        logger.error(`Error cancelling appointments for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to cancel appointments: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Bulk cancel ALL appointments for a date or date range - efficient single operation
 */
async function cancelAllAppointmentsForDate(userId: string, details: any, accessToken?: string): Promise<any> {
    try {
        const startDate = details.start_date;
        const endDate = details.end_date || details.start_date;
        
        logger.info(`Bulk cancelling all appointments for user ${userId} from ${startDate} to ${endDate}`);

        // Get all appointments in date range that aren't already cancelled
        const query = customDb
            .collection('users')
            .doc(userId)
            .collection('appointments')
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .where('status', '!=', 'cancelled');

        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            return {
                success: true,
                message: `No appointments found to cancel between ${startDate} and ${endDate}`,
                cancelledCount: 0
            };
        }

        // Prepare batch operation for Firestore
        const batch = customDb.batch();
        const googleEventIds: string[] = [];
        const cancelledAppointments: any[] = [];

        // Process all appointments
        querySnapshot.forEach(doc => {
            const appointment = doc.data() as AppointmentData;
            
            // Update status in batch
            batch.update(doc.ref, {
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp()
            });

            // Collect Google Calendar event IDs
            if (appointment.googleCalendarEventId) {
                googleEventIds.push(appointment.googleCalendarEventId);
            }

            cancelledAppointments.push({
                id: appointment.id,
                title: appointment.title,
                date: appointment.date,
                time: appointment.time
            });
        });

        // Commit all Firestore updates in one batch
        await batch.commit();
        logger.info(`Cancelled ${cancelledAppointments.length} appointments in Firestore`);

        // Bulk cancel Google Calendar events if access token provided
        let calendarResults: { successful: string[], failed: string[] } = { successful: [], failed: [] };
        if (googleEventIds.length > 0 && accessToken) {
            try {
                calendarResults = await bulkCancelGoogleCalendarEvents(userId, googleEventIds, accessToken);
                logger.info(`Google Calendar bulk cancellation: ${calendarResults.successful.length} successful, ${calendarResults.failed.length} failed`);
            } catch (calendarError) {
                logger.warn(`Google Calendar bulk cancellation failed, but local appointments were cancelled:`, calendarError);
            }
        }

        // Format response message
        let message = `Successfully cancelled ${cancelledAppointments.length} appointment${cancelledAppointments.length !== 1 ? 's' : ''}`;
        
        if (startDate === endDate) {
            message += ` for ${startDate}`;
        } else {
            message += ` from ${startDate} to ${endDate}`;
        }

        if (calendarResults.failed.length > 0) {
            message += ` (${calendarResults.failed.length} calendar sync errors)`;
        }

        return {
            success: true,
            message,
            cancelledCount: cancelledAppointments.length,
            appointments: cancelledAppointments,
            calendarSync: {
                successful: calendarResults.successful.length,
                failed: calendarResults.failed.length
            }
        };

    } catch (error) {
        logger.error(`Error in bulk appointment cancellation for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to cancel appointments: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

async function getAppointments(userId: string, details: any, message: string): Promise<any> {
    try {
        logger.info(`Getting appointments for user ${userId}:`, details);

        // Validate required fields
        if (!details.start_date) {
            throw new Error('Start date is required for retrieving appointments');
        }

        const startDate = details.start_date;
        const endDate = details.end_date || details.start_date;

        logger.info(`Fetching appointments from ${startDate} to ${endDate}`);

        // Query with proper composite index - efficient at scale
        let query = customDb
            .collection('users')
            .doc(userId)
            .collection('appointments')
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .where('status', '!=', 'cancelled')
            .orderBy('date', 'asc')
            .orderBy('status', 'asc')
            .orderBy('time', 'asc');

        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            return {
                success: true,
                message: `No appointments found between ${startDate} and ${endDate}`,
                appointments: []
            };
        }

        const appointments = [];
        for (const doc of querySnapshot.docs) {
            const appointmentData = doc.data() as AppointmentData;
            // No need to filter - query already excludes cancelled appointments
            appointments.push({
                id: appointmentData.id,
                title: appointmentData.title,
                date: appointmentData.date,
                time: appointmentData.time,
                duration: appointmentData.duration,
                attendees: appointmentData.attendees,
                location: appointmentData.location,
                description: appointmentData.description,
                type: appointmentData.type,
                meetingLink: appointmentData.meetingLink,
                calendarSynced: appointmentData.calendarSynced
            });
        }

        // No need to sort - query already returns sorted results
        logger.info(`Found ${appointments.length} appointments for user ${userId}`);

        // Format the response message based on the date range
        let responseMessage = message;
        if (startDate === endDate) {
            responseMessage = `You have ${appointments.length} appointment${appointments.length !== 1 ? 's' : ''} on ${startDate}`;
        } else {
            responseMessage = `You have ${appointments.length} appointment${appointments.length !== 1 ? 's' : ''} from ${startDate} to ${endDate}`;
        }

        // Add summary of appointments
        if (appointments.length > 0) {
            const appointmentSummary = appointments.map(apt => {
                const timeStr = apt.time !== '00:00' ? ` at ${apt.time}` : '';
                const typeStr = apt.type === 'personal_event' ? ' (personal)' : '';
                return `- ${apt.title}${timeStr}${typeStr}`;
            }).join('\n');

            responseMessage += ':\n' + appointmentSummary;
        }

        return {
            success: true,
            message: responseMessage,
            appointments,
            count: appointments.length,
            dateRange: { startDate, endDate }
        };

    } catch (error) {
        logger.error(`Error getting appointments for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to retrieve appointments: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error',
            appointments: []
        };
    }
}

async function setAvailability(userId: string, details: any, message: string): Promise<any> {
    try {
        logger.info(`Setting availability for user ${userId}:`, details);

        // Prepare availability data
        const availabilityData = {
            monday: details.monday || null,
            tuesday: details.tuesday || null,
            wednesday: details.wednesday || null,
            thursday: details.thursday || null,
            friday: details.friday || null,
            saturday: details.saturday || null,
            sunday: details.sunday || null,
            lastUpdated: FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await customDb
            .collection('users')
            .doc(userId)
            .collection('settings')
            .doc('availability')
            .set(availabilityData, { merge: true });

        logger.info(`Availability saved for user ${userId}`);

        // Create a summary of the availability
        const availableDays = [];
        for (const [day, schedule] of Object.entries(availabilityData)) {
            if (schedule && typeof schedule === 'object' && 'start' in schedule && 'end' in schedule) {
                availableDays.push(`${day}: ${schedule.start} - ${schedule.end}`);
            }
        }

        const summaryMessage = availableDays.length > 0
            ? `${message}\nYour availability:\n${availableDays.join('\n')}`
            : message;

        return {
            success: true,
            message: summaryMessage,
            availability: availabilityData
        };

    } catch (error) {
        logger.error(`Error setting availability for user ${userId}:`, error);
        return {
            success: false,
            message: `Failed to set availability: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Process conversational voice command using OpenAI Assistant API
 * This is a Callable function that can be called directly from client apps
 */
export const processVoiceCommand = onCall({ secrets: [OPENAI_API_KEY2] }, async (request) => {
    const { data, auth } = request;

    // --- FIREBASE AUTHENTICATION ---
    const userId = validateUserAuth(auth);
    logger.info(`Processing command for authenticated user: ${userId}`);

    const userCommandText = validateCommand(data.command);
    const userTimezone = data.timezone || 'America/Los_Angeles'; // Default fallback
    logger.info(`Processing conversational command for user ${userId}: "${userCommandText}" in timezone: ${userTimezone}`);

    const openai = getOpenAIClient();

    try {
        // --- ASSISTANT & THREAD MANAGEMENT ---
        const assistantId = await getOrCreateAssistant(userTimezone);
        const threadId = await getOrCreateThread(userId);

        logger.info(`Using Assistant ${assistantId} and Thread ${threadId} for user ${userId}`);
        
        // Log approximate token usage for monitoring
        const commandLength = userCommandText.length;
        const instructionsLength = 8000; // Approximate instruction length
        const estimatedInputTokens = (commandLength + instructionsLength) / 4; // Rough estimate: 4 chars per token
        logger.info(`📊 Estimated input tokens: ~${Math.round(estimatedInputTokens)} (command: ${commandLength} chars)`);

        // --- CHECK FOR PARTIAL CONTEXT ---
        const partialContext = await getPartialAppointmentContext(userId);
        let contextualizedCommand = userCommandText;
        
        if (partialContext?.collectedData) {
            const contextInfo = `[Previous context: Event type: ${partialContext.eventType}, Collected data: ${JSON.stringify(partialContext.collectedData)}, Missing: ${partialContext.missingFields?.join(', ')}]\n\n`;
            contextualizedCommand = contextInfo + userCommandText;
            logger.info(`Adding partial context to message for user ${userId}`);
        }
        
        // --- ADD USER MESSAGE TO THREAD ---
        // Check for active runs and handle thread concurrency issues
        let finalThreadId = threadId;
        try {
            await openai.beta.threads.messages.create(threadId, {
                role: "user",
                content: contextualizedCommand
            });
        } catch (error) {
            if (error instanceof Error && error.message.includes('while a run') && error.message.includes('is active')) {
                logger.warn(`Thread ${threadId} has active run, attempting to resolve...`);
                
                // Try to find and cancel the active run
                try {
                    const runs = await openai.beta.threads.runs.list(threadId);
                    const activeRun = runs.data.find(run => 
                        run.status === 'queued' || 
                        run.status === 'in_progress' || 
                        run.status === 'requires_action'
                    );
                    
                    if (activeRun) {
                        logger.info(`Cancelling active run: ${activeRun.id}`);
                        await openai.beta.threads.runs.cancel(threadId, activeRun.id);
                        
                        // Wait for cancellation to complete
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Retry adding message to the same thread
                        await openai.beta.threads.messages.create(threadId, {
                            role: "user",
                            content: contextualizedCommand
                        });
                        logger.info(`Successfully added message to thread after cancelling active run`);
                    }
                } catch (cancelError) {
                    logger.warn(`Failed to cancel active run, creating new thread:`, cancelError);
                    
                    // Create a new thread as fallback
                    const newThread = await openai.beta.threads.create();
                    finalThreadId = newThread.id;
                    
                    // Update user's thread ID in database
                    await customDb.collection('users').doc(userId).update({
                        activeThreadId: finalThreadId,
                        threadCreatedAt: FieldValue.serverTimestamp(),
                        previousThreadId: threadId // Keep reference to old thread
                    });
                    
                    // Add message to new thread
                    await openai.beta.threads.messages.create(finalThreadId, {
                        role: "user",
                        content: contextualizedCommand
                    });
                    
                    logger.info(`Created new thread ${finalThreadId} and added message`);
                }
            } else {
                // Re-throw other errors
                throw error;
            }
        }

        // --- RUN ASSISTANT ---
        const run = await openai.beta.threads.runs.create(finalThreadId, {
            assistant_id: assistantId
        });

        logger.info(`Started Assistant run: ${run.id}`);

        // --- POLL FOR COMPLETION ---
        let runStatus = run;
        const maxPollingTime = 60000; // 60 seconds - increased for complex operations
        const pollingInterval = 1000; // 1 second
        const startTime = Date.now();

        while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
            if (Date.now() - startTime > maxPollingTime) {
                throw new Error('Assistant run timed out');
            }

            await new Promise(resolve => setTimeout(resolve, pollingInterval));
            runStatus = await openai.beta.threads.runs.retrieve(finalThreadId, run.id);
            logger.info(`Run status: ${runStatus.status}`);
        }

        // --- HANDLE FUNCTION CALLS ---
        if (runStatus.status === 'requires_action') {
            const requiredActions = runStatus.required_action?.submit_tool_outputs?.tool_calls;
            if (requiredActions) {
                logger.info(`Processing ${requiredActions.length} function calls`);

                const toolOutputs = [];
                for (const toolCall of requiredActions) {
                    if (toolCall.type === 'function') {
                        const functionName = toolCall.function.name;
                        const functionArgs = JSON.parse(toolCall.function.arguments);

                        const functionResult = await handleFunctionCall(
                            functionName,
                            functionArgs,
                            userId,
                            data.googleCalendarToken
                        );

                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(functionResult)
                        });
                    }
                }

                // Submit tool outputs
                runStatus = await openai.beta.threads.runs.submitToolOutputs(finalThreadId, run.id, {
                    tool_outputs: toolOutputs
                });

                // Poll again for completion with extended timeout after function calls
                const extendedTimeout = 90000; // 90 seconds for post-function processing
                const functionStartTime = Date.now();
                
                while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
                    if (Date.now() - functionStartTime > extendedTimeout) {
                        throw new Error('Assistant run timed out after function calls');
                    }
                    await new Promise(resolve => setTimeout(resolve, pollingInterval));
                    runStatus = await openai.beta.threads.runs.retrieve(finalThreadId, run.id);
                }
            }
        }

        // --- GET ASSISTANT RESPONSE ---
        if (runStatus.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(finalThreadId);
            const lastMessage = messages.data[0];

            if (lastMessage.role === 'assistant') {
                const messageContent = lastMessage.content[0];
                if (messageContent.type === 'text') {
                    const assistantResponse = messageContent.text.value;

                    logger.info(`Assistant response: ${assistantResponse}`);

                    return {
                        success: true,
                        message: assistantResponse,
                        conversational: true,
                        threadId: finalThreadId
                    };
                }
            }
        }

        // --- HANDLE ERRORS ---
        if (runStatus.status === 'failed') {
            logger.error(`Assistant run failed: ${runStatus.last_error?.message}`);
            return {
                success: false,
                message: "I encountered an error while processing your request. Please try again.",
                error: runStatus.last_error?.message
            };
        }

        // --- FALLBACK RESPONSE ---
        return {
            success: false,
            message: "I couldn't process your request right now. Please try again.",
            status: runStatus.status
        };

    } catch (error) {
        logger.error("Error during conversational command processing:", error);

        // Provide user-friendly error messages
        if (error instanceof Error) {
            if (error.message.includes('timeout')) {
                return {
                    success: false,
                    message: "The request is taking longer than usual. Please try again."
                };
            } else if (error.message.includes('API key')) {
                return {
                    success: false,
                    message: "There's a configuration issue. Please contact support."
                };
            }
        }

        return {
            success: false,
            message: "I encountered an error while processing your request. Please try again.",
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

/**
 * Check if user has valid Google Calendar authentication
 */
export const checkGoogleCalendarAuth = onCall(async (request) => {
    const { auth } = request;

    // Validate user authentication
    const userId = validateUserAuth(auth);
    logger.info(`Checking Google Calendar auth for user: ${userId}`);

    try {
        // Check if tokens exist in Firestore
        const tokenDoc = await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .get();

        if (!tokenDoc.exists) {
            logger.info(`No Google Calendar tokens found for user: ${userId}`);
            return {
                success: false,
                authenticated: false,
                message: 'No Google Calendar authentication found'
            };
        }

        const tokenData = tokenDoc.data();

        // Check if we have the required tokens
        if (!tokenData?.access_token) {
            logger.info(`No access token found for user: ${userId}`);
            return {
                success: false,
                authenticated: false,
                message: 'Google Calendar authentication is incomplete'
            };
        }

        // Check if token is expired
        const now = Date.now();
        const tokenExpiryTime = tokenData.expiry_date;

        if (tokenExpiryTime && now >= tokenExpiryTime) {
            logger.info(`Access token expired for user: ${userId}. iOS app needs to refresh token.`);
            return {
                success: false,
                authenticated: false,
                message: 'Google Calendar authentication expired. Please refresh in the app.'
            };
        }

        logger.info(`Google Calendar authentication valid for user: ${userId}`);
        return {
            success: true,
            authenticated: true,
            message: 'Google Calendar authentication is valid',
            email: tokenData.email || '',
            name: tokenData.name || ''
        };

    } catch (error) {
        logger.error(`Error checking Google Calendar auth for user ${userId}:`, error);
        return {
            success: false,
            authenticated: false,
            message: 'Failed to check Google Calendar authentication',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

/**
 * Store Google Calendar authentication tokens from iOS app
 */
export const storeGoogleCalendarAuth = onCall(async (request) => {
    const { data, auth } = request;

    // Validate user authentication
    const userId = validateUserAuth(auth);
    logger.info(`Storing Google Calendar auth for user: ${userId}`);

    try {
        const {
            accessToken,
            refreshToken,
            expiryDate,
            scopes,
            name,
            email
        } = data;

        if (!accessToken) {
            throw new Error('Access token is required');
        }

        // Store tokens in Firestore
        const tokenData = {
            access_token: accessToken,
            refresh_token: refreshToken || '',
            expiry_date: expiryDate || 0,
            scopes: scopes || ['https://www.googleapis.com/auth/calendar.events'],
            token_type: 'Bearer',

            // User profile information
            email: email || '',
            name: name || '',

            // Metadata
            last_updated: FieldValue.serverTimestamp(),
            created_at: FieldValue.serverTimestamp()
        };

        await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .set(tokenData, { merge: true });

        logger.info(`Google Calendar tokens stored successfully for user: ${userId}`);

        return {
            success: true,
            message: 'Google Calendar authentication stored successfully'
        };

    } catch (error) {
        logger.error(`Error storing Google Calendar auth for user ${userId}:`, error);
        throw new Error(`Failed to store Google Calendar authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});