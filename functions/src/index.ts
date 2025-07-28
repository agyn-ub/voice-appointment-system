/**
 * Voice Command Processing Functions
 * Firebase Functions v2 implementation for processing voice commands with AI
 */

import { onCall } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { google } from "googleapis";

// Initialize Firebase Admin SDK for server-side operations
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Initialize Firebase Admin (only needs to be done once)
initializeApp();

// Get Firestore instance for the default database
const customDb = getFirestore();

// OpenAI API configuration using Firebase Functions v2 params
const openaiApiKey = defineString("OPENAI_API_KEY");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || openaiApiKey.value();
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Google OAuth configuration - hardcoded for testing
const GOOGLE_CLIENT_ID = "73003602008-6g4n76290bt9mrtqkicr443mjjtm5qis.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const REDIRECT_URI = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/googleOAuthCallback`;

// App ID for consistent document paths
const APP_ID = "my-voice-calendly-app";

// Define TypeScript interfaces for our data structures
interface AppointmentData {
    title: string;
    date: string;
    time: string;
    duration: number;
    attendees: string[];
    timestamp: Date;
    status: string;
    createdAt: FieldValue;
    googleCalendarEventId?: string | null;
    meetingLink?: string | null;
    calendarSynced?: boolean;
    calendarSyncError?: string;
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * @param str1 First string
 * @param str2 Second string
 * @returns Similarity score between 0 and 1
 */
function calculateSimilarity(str1: string, str2: string): number {
    try {
        // Handle null/undefined inputs
        if (!str1 || !str2) return 0.0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const distance = levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    } catch (error) {
        logger.error("Error in calculateSimilarity:", error);
        return 0.0; // Return 0 similarity on error
    }
}

/**
 * Calculate Levenshtein distance between two strings
 * @param str1 First string
 * @param str2 Second string
 * @returns Distance (number of edits needed)
 */
function levenshteinDistance(str1: string, str2: string): number {
    try {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    } catch (error) {
        logger.error("Error in levenshteinDistance:", error);
        return 999; // Return high distance on error
    }
}

/**
 * Process voice command using AI and perform scheduling operations
 * This is a Callable function that can be called directly from client apps
 * 
 * @param data - Contains the voice command text
 * @param context - Contains authentication and call context
 */
export const processVoiceCommand = onCall(async (request) => {
    const { data, auth } = request;

    // --- FIREBASE AUTHENTICATION ---
    // Ensure user is authenticated
    if (!auth) {
        throw new Error('User must be authenticated to use this function.');
    }

    const userId = auth.uid;
    logger.info(`Processing command for authenticated user: ${userId}`);
    // ---------------------------------------------------

    const userCommandText = data.command; // The transcribed voice command from the client app

    // Basic validation for the input command
    if (!userCommandText || typeof userCommandText !== 'string' || userCommandText.trim() === '') {
        throw new Error('The command text is missing or invalid.');
    }

    logger.info(`Processing command for user ${userId}: "${userCommandText}"`);

    /**
     * Helper function to get an authenticated Google OAuth2 client
     * Handles token refresh and storage
     * 
     * @param userId - User ID to retrieve tokens for
     * @returns Authenticated OAuth2Client
     */
    async function getGoogleOAuth2Client(userId: string) {
        try {
            logger.info(`Getting Google OAuth client for user: ${userId}`);

            // Check if Google OAuth credentials are configured
            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
                logger.error("Google OAuth credentials not configured");
                throw new Error('Google Calendar integration not properly configured. Missing OAuth credentials.');
            }

            // Initialize OAuth2 client
            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                REDIRECT_URI
            );

            // Fetch tokens from Firestore
            const tokenDoc = await customDb
                .collection('artifacts')
                .doc(APP_ID)
                .collection('users')
                .doc(userId)
                .collection('tokens')
                .doc('googleCalendar')
                .get();

            // Check if tokens exist
            if (!tokenDoc.exists) {
                logger.error(`No Google Calendar tokens found for user: ${userId}`);
                throw new Error('Google Calendar not connected. Please authorize access first.');
            }

            const tokenData = tokenDoc.data();

            // Check if refresh token exists
            if (!tokenData?.refresh_token) {
                logger.error(`Missing refresh token for user: ${userId}`);
                throw new Error('Google Calendar connection is incomplete. Please reauthorize access.');
            }

            // Set credentials on OAuth client
            oAuth2Client.setCredentials({
                refresh_token: tokenData.refresh_token,
                access_token: tokenData.access_token,
                expiry_date: tokenData.expiry_date
            });

            // Check if token is expired or about to expire (within 5 minutes)
            const now = Date.now();
            const tokenExpiryTime = tokenData.expiry_date;
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (!tokenExpiryTime || now + fiveMinutesInMs >= tokenExpiryTime) {
                logger.info(`Refreshing access token for user: ${userId}`);

                // Refresh the token
                const refreshResponse = await oAuth2Client.refreshAccessToken();
                const tokens = refreshResponse.credentials;

                // Update tokens in Firestore
                await customDb
                    .collection('artifacts')
                    .doc(APP_ID)
                    .collection('users')
                    .doc(userId)
                    .collection('tokens')
                    .doc('googleCalendar')
                    .set({
                        access_token: tokens.access_token,
                        expiry_date: tokens.expiry_date,
                        last_updated: FieldValue.serverTimestamp()
                    }, { merge: true });

                logger.info(`Successfully refreshed and stored tokens for user: ${userId}`);
            }

            return oAuth2Client;
        } catch (error) {
            logger.error('Error getting Google OAuth client:', error);
            throw new Error(`Failed to initialize Google Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // --- LLM Integration: Construct Prompt and Make API Call ---
    let llmResponseJson;
    const today = new Date().toISOString().slice(0, 10); // Get today's date in YYYY-MM-DD format

    // Define the prompt for the LLM. This instructs the LLM on how to parse the command
    // and what JSON structure to return.
    const systemPrompt = `You are a helpful and precise scheduling assistant. Your task is to analyze user commands related to scheduling appointments, setting availability, or cancelling appointments. You must extract the user's intent and all relevant details, and return them in a strict JSON format.

    Today's date is ${today}. When inferring dates (e.g., "tomorrow", "next Tuesday"), use this as the reference.

    --- JSON Output Structure ---
    {
      "intent": "string", // One of: "schedule_appointment", "set_availability", "cancel_appointment", "get_appointments", "unclear"
      "details": { /* object with intent-specific parameters */ },
      "llm_response_message": "string" // Optional: A natural language confirmation or clarification from you.
    }

    --- Intents and Details Schema ---
    1. "schedule_appointment": For creating new appointments.
       Details: {
         "title": "string",          // e.g., "Project Review", "Call with Sarah" (can be empty if no specific title mentioned)
         "date": "YYYY-MM-DD",       // e.g., "2025-07-25"
         "time": "HH:MM",            // e.g., "14:30" (24-hour format)
         "duration": "number",       // e.g., 30 (in minutes)
         "attendees": ["string"],     // e.g., ["John", "Alice"] (can be empty array if no attendees mentioned)
         "meeting_platform": "string" // Optional: e.g., "Google Meet", "Zoom", "In Person"
       }
       Example User Commands:
       - "Schedule a project review with Alice and Bob for next Tuesday at 10 AM for 30 minutes."
       - "Make an appointment for tomorrow with John for 5 PM" (title can be empty, will be auto-generated)
       - "Schedule a meeting with Sarah tomorrow at 2 PM for 1 hour"
       - "Book an appointment with John for next Friday at 3 PM"
       - "Set up a Google Meet with the team tomorrow at 9 AM"

    2. "set_availability": For updating user's general availability.
       Details: {
         "monday": { "start": "HH:MM", "end": "HH:MM" },
         "tuesday": { "start": "HH:MM", "end": "HH:MM" },
         "wednesday": { "start": "HH:MM", "end": "HH:MM" },
         "thursday": { "start": "HH:MM", "end": "HH:MM" },
         "friday": { "start": "HH:MM", "end": "HH:MM" },
         "saturday": { "start": "HH:MM", "end": "HH:MM" }, // Use "" for start/end if unavailable
         "sunday": { "start": "HH:MM", "end": "HH:MM" }    // Use "" for start/end if unavailable
       }
       Example User Command: "Set my availability to Monday to Friday from 9 AM to 5 PM and not available on weekends."
       Example User Command: "I'm free on Tuesdays from 10 to 4."

    3. "cancel_appointment": For canceling/deleting/removing an existing appointment.
       Details: {
         "title": "string",          // e.g., "Project Review" (can be partial match, or empty if cancelling by attendees)
         "date": "YYYY-MM-DD",       // e.g., "2025-07-20"
         "time": "HH:MM",            // Optional: specific time (e.g., "14:30")
         "attendees": ["string"]     // Optional: specific people (e.g., ["John", "Sara"])
       }
       Example User Commands:
       - "Cancel the project review meeting on July 20th."
       - "Delete my doctor appointment tomorrow."
       - "Remove the meeting with Sara on Friday."
       - "Cancel my appointment with John at 2 PM."
       - "Delete appointment with Sara tomorrow."
       - "Cancel the 3 PM meeting tomorrow."
       - "Remove my lunch meeting with Alice."
       - "Delete the meeting at 11 PM tomorrow."
       - "Cancel appointment with John for tomorrow 1 PM" (title can be empty, use attendees)
       - "Delete my meeting with John tomorrow" (title can be empty, use attendees)

    4. "get_appointments": For retrieving appointments in a specific period.
       Details: {
         "start_date": "YYYY-MM-DD", // e.g., "2025-07-25"
         "end_date": "YYYY-MM-DD"    // e.g., "2025-07-31" (optional, if not specified use start_date)
       }
       Example User Command: "Show me my appointments for this week."
       Example User Command: "What appointments do I have tomorrow?"
       Example User Command: "List my meetings from July 25th to July 30th."

    5. "unclear": If the command cannot be understood or is irrelevant to scheduling.
       Details: {} // Empty object
       Example User Command: "What's the weather like?"
    `;

    // Check if OpenAI API key is configured
    if (!OPENAI_API_KEY) {
        logger.error("OpenAI API key not configured");
        throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable for local development or openai.api_key in Firebase config for production.');
    }

    // --- LLM API Call (OpenAI GPT-4o-mini) ---
    const llmRequestPayload = {
        model: "gpt-4o-mini", // Specify the model
        response_format: { "type": "json_object" }, // Crucial for strict JSON output
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userCommandText }
        ],
        temperature: 0.7, // Adjust creativity/randomness (0.0 to 2.0)
        max_tokens: 500   // Limit response length to avoid excessive tokens
    };

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}` // OpenAI uses Bearer token
            },
            body: JSON.stringify(llmRequestPayload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            logger.error(`LLM API error status: ${response.status}, body: ${errorBody}`);
            throw new Error(`LLM API call failed: ${response.statusText}`);
        }

        const llmRawResult = await response.json();
        logger.info("Raw LLM Response:", JSON.stringify(llmRawResult));

        // Extract the JSON string from OpenAI's response.
        // It's typically in choices[0].message.content
        if (llmRawResult.choices && llmRawResult.choices.length > 0 &&
            llmRawResult.choices[0].message && llmRawResult.choices[0].message.content) {
            const llmJsonString = llmRawResult.choices[0].message.content;
            llmResponseJson = JSON.parse(llmJsonString);
        } else {
            throw new Error("LLM response did not contain expected content structure (choices[0].message.content).");
        }

    } catch (error) {
        logger.error("Error during LLM API call or parsing:", error);
        throw new Error('Failed to get a valid response from the AI model.');
    }

    logger.info("Parsed LLM Response:", JSON.stringify(llmResponseJson));

    // --- Intent-Based Dispatch and Firestore Operations ---
    const { intent, details, llm_response_message } = llmResponseJson;

    let clientMessage = llm_response_message || "Command processed."; // Default message if LLM doesn't provide one
    let successStatus = true; // Assume success unless an error occurs or intent is 'unclear'

    try {
        switch (intent) {
            case "schedule_appointment":
                // Validate required fields for scheduling
                if (!details.date || !details.time || typeof details.duration !== 'number') {
                    throw new Error('Missing or invalid details for scheduling an appointment.');
                }

                // Generate a default title if none is provided
                let appointmentTitle = details.title;
                if (!appointmentTitle || appointmentTitle.trim() === '') {
                    const attendeesText = details.attendees && details.attendees.length > 0
                        ? ` with ${details.attendees.join(', ')}`
                        : '';
                    appointmentTitle = `Meeting${attendeesText}`;
                }

                // Convert date and time strings to a proper JavaScript Date object, then to Firestore Timestamp
                const appointmentDateTime = new Date(`${details.date}T${details.time}:00`);
                if (isNaN(appointmentDateTime.getTime())) {
                    throw new Error('AI provided an invalid date or time format.');
                }

                // Optional: Implement availability check and conflict detection here
                // This would involve querying the user's availability and existing appointments from Firestore.
                // For simplicity, we'll skip the detailed check in this basic example,
                // but you would add it before adding the appointment.

                // Create appointment data for Firestore
                const appointmentData: AppointmentData = {
                    title: appointmentTitle,
                    date: details.date, // Store as string for easy display
                    time: details.time, // Store as string
                    duration: details.duration, // Store as number
                    attendees: details.attendees || [], // Ensure it's an array
                    timestamp: appointmentDateTime, // Store as Date/Timestamp for proper ordering and querying
                    status: 'confirmed',
                    createdAt: FieldValue.serverTimestamp() // Timestamp of creation
                };

                // Google Calendar Integration
                let googleCalendarEventId = null;
                let meetingLink = null;
                let calendarSyncSuccess = false;

                try {
                    // Try to sync with Google Calendar if available
                    const oAuth2Client = await getGoogleOAuth2Client(userId);
                    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

                    // Format attendees for Google Calendar
                    const calendarAttendees = details.attendees?.map((attendee: string) => ({
                        email: attendee.includes('@') ? attendee : `${attendee.toLowerCase().replace(/\s+/g, '.')}@example.com`,
                        displayName: attendee
                    })) || [];

                    // Calculate end time
                    const endDateTime = new Date(appointmentDateTime);
                    endDateTime.setMinutes(endDateTime.getMinutes() + details.duration);

                    // Create event resource
                    const eventResource: any = {
                        summary: appointmentTitle,
                        description: `Appointment created via Voice Command System`,
                        start: {
                            dateTime: appointmentDateTime.toISOString(),
                            timeZone: 'America/Los_Angeles', // Default timezone, could be made dynamic
                        },
                        end: {
                            dateTime: endDateTime.toISOString(),
                            timeZone: 'America/Los_Angeles', // Default timezone, could be made dynamic
                        },
                        attendees: calendarAttendees,
                        reminders: {
                            useDefault: true
                        }
                    };

                    // Add Google Meet integration if requested
                    const meetingPlatform = details.meeting_platform?.toLowerCase() || '';
                    if (meetingPlatform.includes('google meet') || meetingPlatform.includes('meet')) {
                        eventResource.conferenceData = {
                            createRequest: {
                                requestId: `${userId}-${Date.now()}`,
                                conferenceSolutionKey: { type: 'hangoutsMeet' }
                            }
                        };
                    }

                    // Insert event to Google Calendar
                    logger.info(`Creating Google Calendar event for user ${userId}: "${appointmentTitle}"`);
                    const calendarResponse = await calendar.events.insert({
                        calendarId: 'primary',
                        conferenceDataVersion: 1, // Required for Google Meet
                        sendUpdates: 'all', // Send email notifications to attendees
                        requestBody: eventResource
                    });

                    // Extract event ID and meeting link
                    googleCalendarEventId = calendarResponse.data.id || null;
                    meetingLink = calendarResponse.data.hangoutLink || null;
                    calendarSyncSuccess = true;

                    logger.info(`Successfully created Google Calendar event: ${googleCalendarEventId}`);

                    // Add Google Calendar info to appointment data
                    if (googleCalendarEventId) {
                        appointmentData.googleCalendarEventId = googleCalendarEventId;
                    }
                    if (meetingLink) {
                        appointmentData.meetingLink = meetingLink;
                    }
                    appointmentData.calendarSynced = true;

                } catch (error) {
                    // Log error but continue with Firestore save
                    logger.error(`Failed to sync with Google Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    appointmentData.calendarSynced = false;
                    appointmentData.calendarSyncError = error instanceof Error ? error.message : 'Unknown error';
                }

                // Save appointment to Firestore
                await customDb.collection('users').doc(userId).collection('appointments').add(appointmentData);

                // Update client message based on calendar sync status
                if (calendarSyncSuccess) {
                    const meetingInfo = meetingLink ? ` A Google Meet link has been created.` : '';
                    clientMessage = llm_response_message || `Appointment "${appointmentTitle}" scheduled successfully and synced with Google Calendar.${meetingInfo}`;
                } else {
                    clientMessage = llm_response_message || `Appointment "${appointmentTitle}" scheduled successfully in the app only. Failed to sync with Google Calendar.`;
                }
                break;

            case "set_availability":
                // Validate details for availability (e.g., check if day names are valid, times are HH:MM)
                // For simplicity, we'll assume LLM provides valid structure.
                if (Object.keys(details).length === 0) {
                    throw new Error('Missing details for setting availability.');
                }

                await customDb.collection('users').doc(userId).collection('availability').doc('userAvailability').set(details, { merge: true });
                clientMessage = llm_response_message || "Your availability has been updated.";
                break;

            case "cancel_appointment":
                // Validate required fields for cancellation
                // Allow cancellation by title OR by attendees (for cases like "cancel appointment with John")
                if (!details.date || (!details.title && (!details.attendees || details.attendees.length === 0))) {
                    throw new Error('Missing or invalid details for cancelling an appointment. Need either a title or attendees to identify the appointment.');
                }

                // Query Firestore to find the specific appointment to cancel
                const appointmentsToCancelQuery = await customDb.collection('users').doc(userId).collection('appointments')
                    .where('date', '==', details.date)
                    .get();

                let cancelledCount = 0;
                let availableAppointments: any[] = [];
                let suggestedMatches: string[] = [];
                let appointmentsToDeleteFromGCal: { id: string; googleCalendarEventId: string }[] = [];
                let calendarDeleteSuccess = false;

                if (!appointmentsToCancelQuery.empty) {
                    const batch = customDb.batch();

                    // First pass: collect all appointments and find matches
                    appointmentsToCancelQuery.docs.forEach(docSnap => {
                        try {
                            const appointmentData = docSnap.data();

                            // Validate appointment data
                            if (!appointmentData || !appointmentData.title) {
                                logger.warn("Skipping appointment with invalid data:", docSnap.id);
                                return;
                            }

                            availableAppointments.push({
                                id: docSnap.id,
                                title: appointmentData.title,
                                time: appointmentData.time || '',
                                attendees: appointmentData.attendees || [],
                                googleCalendarEventId: appointmentData.googleCalendarEventId || null
                            });

                            // Smart matching logic
                            const titleMatch = appointmentData.title &&
                                appointmentData.title.toLowerCase().includes(details.title.toLowerCase());

                            // Time-based matching (if user mentioned time)
                            const timeMatch = details.time && appointmentData.time === details.time;

                            // Attendee matching (if user mentioned specific person)
                            const attendeeMatch = details.attendees && details.attendees.length > 0 &&
                                appointmentData.attendees && appointmentData.attendees.some((attendee: string) =>
                                    details.attendees.some((searchAttendee: string) =>
                                        attendee.toLowerCase().includes(searchAttendee.toLowerCase())
                                    )
                                );

                            // Fuzzy matching for similar titles (with safety checks)
                            let fuzzyMatch = false;
                            try {
                                if (appointmentData.title && details.title) {
                                    fuzzyMatch = appointmentData.title.toLowerCase().includes(details.title.toLowerCase()) ||
                                        details.title.toLowerCase().includes(appointmentData.title.toLowerCase()) ||
                                        appointmentData.title.toLowerCase().split(' ').some((word: string) =>
                                            details.title.toLowerCase().includes(word)
                                        );
                                }
                            } catch (error) {
                                logger.error("Error in fuzzy matching:", error);
                                fuzzyMatch = false;
                            }

                            if (titleMatch || timeMatch || attendeeMatch || fuzzyMatch) {
                                // Add to batch delete
                                batch.delete(docSnap.ref);

                                // Track for Google Calendar deletion if needed
                                if (appointmentData.googleCalendarEventId) {
                                    appointmentsToDeleteFromGCal.push({
                                        id: docSnap.id,
                                        googleCalendarEventId: appointmentData.googleCalendarEventId
                                    });
                                }

                                cancelledCount++;
                            }
                        } catch (error) {
                            logger.error("Error processing appointment:", docSnap.id, error);
                            // Continue with other appointments
                        }
                    });

                    if (cancelledCount > 0) {
                        // Delete from Firestore
                        await batch.commit();

                        // Try to delete from Google Calendar if applicable
                        if (appointmentsToDeleteFromGCal.length > 0) {
                            try {
                                const oAuth2Client = await getGoogleOAuth2Client(userId);
                                const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

                                // Delete events in parallel
                                const deletePromises = appointmentsToDeleteFromGCal.map(async (apt) => {
                                    try {
                                        await calendar.events.delete({
                                            calendarId: 'primary',
                                            eventId: apt.googleCalendarEventId,
                                            sendUpdates: 'all' // Notify attendees
                                        });
                                        logger.info(`Successfully deleted Google Calendar event: ${apt.googleCalendarEventId}`);
                                        return { success: true, id: apt.id };
                                    } catch (error) {
                                        logger.error(`Failed to delete Google Calendar event ${apt.googleCalendarEventId}:`, error);
                                        return { success: false, id: apt.id, error };
                                    }
                                });

                                // Wait for all delete operations to complete
                                const results = await Promise.all(deletePromises);
                                const successfulDeletes = results.filter(r => r.success).length;

                                if (successfulDeletes > 0) {
                                    logger.info(`Successfully deleted ${successfulDeletes} events from Google Calendar`);
                                    calendarDeleteSuccess = true;
                                }
                            } catch (error) {
                                logger.error("Error deleting events from Google Calendar:", error);
                                // Continue with the response, don't block on Google Calendar errors
                            }
                        }
                    } else {
                        // No exact matches found - provide smart suggestions
                        if (details.title) {
                            availableAppointments.forEach(apt => {
                                try {
                                    const similarity = calculateSimilarity(details.title.toLowerCase(), apt.title.toLowerCase());
                                    if (similarity > 0.3) { // 30% similarity threshold
                                        suggestedMatches.push(`${apt.title} at ${apt.time}${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}`);
                                    }
                                } catch (error) {
                                    logger.error("Error calculating similarity for appointment:", apt.title, error);
                                    // Fallback: add to suggestions anyway
                                    suggestedMatches.push(`${apt.title} at ${apt.time}${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}`);
                                }
                            });
                        }
                    }
                }

                if (cancelledCount > 0) {
                    const countText = cancelledCount === 1 ? "appointment" : "appointments";
                    const safeTitle = details.title || "appointment";
                    const calendarMsg = calendarDeleteSuccess ? " and removed from Google Calendar" : "";
                    clientMessage = `Successfully cancelled ${cancelledCount} ${countText} matching "${safeTitle}" on ${details.date}${calendarMsg}.`;
                } else {
                    if (suggestedMatches.length > 0) {
                        const safeTitle = details.title || "appointment";
                        clientMessage = `No exact match found for "${safeTitle}". Did you mean one of these? ${suggestedMatches.join(', ')}`;
                    } else if (availableAppointments.length > 0) {
                        const appointmentList = availableAppointments.map(apt => {
                            try {
                                return `${apt.title} at ${apt.time}${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}`;
                            } catch (error) {
                                logger.error("Error formatting appointment:", apt, error);
                                return `${apt.title || 'Unknown'} at ${apt.time || 'unknown time'}`;
                            }
                        }).join(', ');
                        const safeTitle = details.title || "appointment";
                        clientMessage = `No appointments found matching "${safeTitle}". Available appointments on ${details.date}: ${appointmentList}`;
                    } else {
                        clientMessage = `No appointments found on ${details.date}.`;
                    }
                    successStatus = false;
                }
                break;

            case "get_appointments":
                // Validate required fields for getting appointments
                if (!details.start_date) {
                    throw new Error('Missing start date for getting appointments.');
                }

                // Set end_date to start_date if not provided (single day query)
                const startDate = details.start_date;
                const endDate = details.end_date || details.start_date;

                // Query Firestore to get appointments in the specified date range
                // NOTE: This query requires a composite index on (date, time) 
                // The index creation URL will be provided in error logs if not created
                const appointmentsQuery = await customDb.collection('users').doc(userId).collection('appointments')
                    .where('date', '>=', startDate)
                    .where('date', '<=', endDate)
                    .orderBy('date')
                    .orderBy('time')  // This line requires the composite index
                    .get();

                // Alternative approach without composite index (fallback):
                // const appointmentsQuery = await customDb.collection('users').doc(userId).collection('appointments')
                //     .where('date', '>=', startDate)
                //     .where('date', '<=', endDate)
                //     .orderBy('date')  // Only order by date, then sort by time in JavaScript
                //     .get();

                const appointments: any[] = [];
                appointmentsQuery.forEach(doc => {
                    const appointmentData = doc.data();
                    appointments.push({
                        id: doc.id,
                        title: appointmentData.title,
                        date: appointmentData.date,
                        time: appointmentData.time,
                        duration: appointmentData.duration,
                        attendees: appointmentData.attendees || [],
                        status: appointmentData.status,
                        meetingLink: appointmentData.meetingLink || null,
                        googleCalendarEventId: appointmentData.googleCalendarEventId || null,
                        calendarSynced: appointmentData.calendarSynced || false
                    });
                });

                // Sort by time in JavaScript (if using the fallback approach above)
                // appointments.sort((a, b) => a.time.localeCompare(b.time));

                if (appointments.length > 0) {
                    // Format appointments for natural language response
                    const appointmentsSummary = appointments.map(apt => {
                        const meetingInfo = apt.meetingLink ? ` (Google Meet available)` : '';
                        return `${apt.title} on ${apt.date} at ${apt.time} (${apt.duration} minutes)${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}${meetingInfo}`;
                    }).join('; ');

                    clientMessage = llm_response_message || `You have ${appointments.length} appointment(s): ${appointmentsSummary}`;
                } else {
                    clientMessage = llm_response_message || `No appointments found from ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''}.`;
                }

                // Return appointments data in the response
                return {
                    success: true,
                    message: clientMessage,
                    intent: intent,
                    details: details,
                    appointments: appointments.map(apt => ({
                        ...apt,
                        meetingLink: apt.meetingLink || null,
                        calendarSynced: apt.calendarSynced || false
                    })) // Include the actual appointments data with meeting links
                };

            case "unclear":
                clientMessage = llm_response_message || "I didn't understand that command. Please try again with a clear instruction to schedule, set availability, cancel, or get appointments.";
                successStatus = false;
                break;

            default:
                clientMessage = "Unknown intent detected by the system. Please try again.";
                successStatus = false;
                break;
        }

        // Return a structured response to the client app
        return {
            success: successStatus,
            message: clientMessage,
            intent: intent,
            details: details
        };

    } catch (error) {
        logger.error("Error during Firestore operation or intent dispatch:", error);
        // Re-throw as an Error for the client to handle
        throw new Error(error instanceof Error ? error.message : 'An unexpected server error occurred during action processing.');
    }
});

/**
 * Google OAuth 2.0 Callback Handler
 * Handles the OAuth callback from Google after user grants consent
 * 
 * @param req - HTTP request containing authorization code and state
 * @param res - HTTP response to send back to user
 */
export const googleOAuthCallback = onRequest(async (req, res) => {
    try {
        // 1. Extract code and state from query parameters
        const { code, state } = req.query;

        if (!code || !state) {
            logger.error("Missing required parameters in OAuth callback", { code: !!code, state: !!state });
            res.status(400).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: #d32f2f;">Authorization Failed</h1>
                        <p>Missing required parameters. Please try the authorization process again.</p>
                        <button onclick="window.close()">Close Window</button>
                    </body>
                </html>
            `);
            return;
        }

        // 2. Extract User ID from state (Firebase Auth UID)
        const userId = state as string;

        // Validate that the userId is a valid Firebase Auth UID format
        if (!userId || userId.length < 10) {
            logger.error("Invalid user ID in OAuth callback state:", userId);
            res.status(400).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: #d32f2f;">Authorization Failed</h1>
                        <p>Invalid user session. Please try the authorization process again.</p>
                        <button onclick="window.close()">Close Window</button>
                    </body>
                </html>
            `);
            return;
        }

        logger.info(`Processing OAuth callback for authenticated user: ${userId}`);

        // 3. Retrieve Google OAuth credentials - hardcoded for testing
        const clientId = "73003602008-6g4n76290bt9mrtqkicr443mjjtm5qis.apps.googleusercontent.com";
        const clientSecret = "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";

        // Debug logging - hardcoded credentials test
        logger.info("Debug - hardcoded clientId:", clientId);
        logger.info("Debug - hardcoded clientSecret:", clientSecret ? "***SET***" : "***NOT SET***");

        if (!clientId || !clientSecret) {
            logger.error("Google OAuth credentials not configured");
            res.status(500).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: #d32f2f;">Configuration Error</h1>
                        <p>OAuth credentials not properly configured. Please contact support.</p>
                        <button onclick="window.close()">Close Window</button>
                    </body>
                </html>
            `);
            return;
        }

        // 4. Initialize Google OAuth2 client
        const redirectUri = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/googleOAuthCallback`;
        const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

        logger.info(`OAuth redirect URI: ${redirectUri}`);

        // 5. Exchange authorization code for tokens
        const { tokens } = await oAuth2Client.getToken(code as string);
        logger.info("Successfully exchanged authorization code for tokens", {
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            expiryDate: tokens.expiry_date
        });

        // 6. Store tokens in Firestore
        const appId = "my-voice-calendly-app";
        const db = getFirestore();

        const tokenData = {
            access_token: tokens.access_token || null,
            refresh_token: tokens.refresh_token || null, // Can be null if not first-time auth
            expiry_date: tokens.expiry_date || null,
            scopes: [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            last_updated: FieldValue.serverTimestamp()
        };

        const tokenDocRef = db
            .collection('artifacts')
            .doc(appId)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar');

        logger.info(`Attempting to store tokens at path: ${tokenDocRef.path}`);

        await tokenDocRef.set(tokenData, { merge: true });

        // Verify the document was created
        const verifyDoc = await tokenDocRef.get();
        if (verifyDoc.exists) {
            logger.info(`✅ Token document successfully created at: ${tokenDocRef.path}`);
            logger.info(`Document data keys: ${Object.keys(verifyDoc.data() || {}).join(', ')}`);
        } else {
            logger.error(`❌ Token document was NOT created at: ${tokenDocRef.path}`);
        }

        logger.info(`Successfully stored OAuth tokens for user: ${userId}`);

        // 7. Redirect to iOS app with success callback
        const successUrl = `voicecalendly://oauth/success?userId=${userId}`;
        logger.info(`Redirecting to iOS app: ${successUrl}`);

        res.status(302).setHeader('Location', successUrl).send(`
            <html>
                <head>
                    <title>Redirecting...</title>
                    <meta http-equiv="refresh" content="0;url=${successUrl}">
                </head>
                <body>
                    <p>Authorization successful! Redirecting to app...</p>
                    <p>If you're not redirected automatically, <a href="${successUrl}">click here</a>.</p>
                </body>
            </html>
        `);

    } catch (error) {
        logger.error("Error in OAuth callback:", error);

        // Extract userId from state if available
        const userId = req.query.state as string || 'unknown';
        const errorUrl = `voicecalendly://oauth/error?userId=${userId}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`;

        res.status(302).setHeader('Location', errorUrl).send(`
            <html>
                <head>
                    <title>Authorization Error</title>
                    <meta http-equiv="refresh" content="0;url=${errorUrl}">
                </head>
                <body>
                    <p>Authorization failed! Redirecting to app...</p>
                    <p>If you're not redirected automatically, <a href="${errorUrl}">click here</a>.</p>
                </body>
            </html>
        `);
    }
}); 