/**
 * Voice Command Processing Functions
 * Firebase Functions v2 implementation for processing voice commands with AI
 */

import { onCall } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { google } from "googleapis";

// Initialize Firebase Admin SDK for server-side operations
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Initialize Firebase Admin (only needs to be done once)
initializeApp();

// Get Firestore instance for the default database
const customDb = getFirestore();

// OpenAI API configuration
const OPENAI_API_KEY2 = defineSecret("OPENAI_API_KEY2");
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Google OAuth configuration - hardcoded for testing
const GOOGLE_CLIENT_ID = "73003602008-0jgk8u5h4s4pdu3010utqovs0kb14fgb.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const REDIRECT_URI = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/googleOAuthCallback`;

// App ID for consistent document paths
const APP_ID = "my-voice-calendly-app";

// Define TypeScript interfaces for our data structures
interface AppointmentData {
    id?: string; // Document ID - will be set after creation
    title: string;
    date: string;
    time: string;
    duration?: number; // Optional to match iOS
    attendees?: string[]; // Optional to match iOS
    // Server-side only fields (not sent to client)
    timestamp?: Date;
    status?: string;
    createdAt?: FieldValue;
    googleCalendarEventId?: string | null;
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
 * Validate and extract user authentication
 */
function validateUserAuth(auth: any): string {
    if (!auth) {
        throw new Error('User must be authenticated to use this function.');
    }
    return auth.uid;
}

/**
 * Validate voice command input
 */
function validateCommand(command: any): string {
    if (!command || typeof command !== 'string' || command.trim() === '') {
        throw new Error('The command text is missing or invalid.');
    }
    return command.trim();
}

/**
 * Get an authenticated Google OAuth2 client
 * Handles token refresh and storage
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

/**
 * Process voice command using AI/LLM
 */
async function processCommandWithAI(command: string): Promise<any> {
    const today = new Date().toISOString().slice(0, 10);

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

    3. "cancel_appointment": For canceling/deleting/removing an existing appointment.
       Details: {
         "title": "string",          // e.g., "Project Review" (can be partial match, or empty if cancelling by attendees)
         "date": "YYYY-MM-DD",       // e.g., "2025-07-20"
         "time": "HH:MM",            // Optional: specific time (e.g., "14:30")
         "attendees": ["string"]     // Optional: specific people (e.g., ["John", "Sara"])
       }

    4. "get_appointments": For retrieving appointments in a specific period.
       Details: {
         "start_date": "YYYY-MM-DD", // e.g., "2025-07-25"
         "end_date": "YYYY-MM-DD"    // e.g., "2025-07-31" (optional, if not specified use start_date)
       }

    5. "unclear": If the command cannot be understood or is irrelevant to scheduling.
       Details: {} // Empty object
    `;

    if (!OPENAI_API_KEY2.value()) {
        logger.error("OpenAI API key not configured");
        throw new Error('OpenAI API key not configured.');
    }

    const llmRequestPayload = {
        model: "gpt-4o-mini",
        response_format: { "type": "json_object" },
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: command }
        ],
        temperature: 0.7,
        max_tokens: 500
    };

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY2.value()}`
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

        if (llmRawResult.choices && llmRawResult.choices.length > 0 &&
            llmRawResult.choices[0].message && llmRawResult.choices[0].message.content) {
            const llmJsonString = llmRawResult.choices[0].message.content;
            return JSON.parse(llmJsonString);
        } else {
            throw new Error("LLM response did not contain expected content structure.");
        }

    } catch (error) {
        logger.error("Error during LLM API call or parsing:", error);
        throw new Error('Failed to get a valid response from the AI model.');
    }
}

/**
 * Schedule a new appointment
 */
async function scheduleAppointment(userId: string, details: any, llmResponseMessage: string): Promise<any> {
    // Validate required fields
    if (!details.date || !details.time || typeof details.duration !== 'number') {
        throw new Error('Missing or invalid details for scheduling an appointment.');
    }

    // Generate default title if none provided
    let appointmentTitle = details.title;
    if (!appointmentTitle || appointmentTitle.trim() === '') {
        const attendeesText = details.attendees && details.attendees.length > 0
            ? ` with ${details.attendees.join(', ')}`
            : '';
        appointmentTitle = `Meeting${attendeesText}`;
    }

    // Convert date and time to Date object
    const appointmentDateTime = new Date(`${details.date}T${details.time}:00`);
    if (isNaN(appointmentDateTime.getTime())) {
        throw new Error('AI provided an invalid date or time format.');
    }

    // Create appointment data - iOS-compatible format
    const appointmentData: AppointmentData = {
        title: appointmentTitle,
        date: details.date,
        time: details.time,
        // Server-side fields
        timestamp: appointmentDateTime,
        status: 'confirmed',
        createdAt: FieldValue.serverTimestamp()
    };

    // Add optional fields only if they have values
    if (details.duration) {
        appointmentData.duration = details.duration;
    }
    if (details.attendees?.length > 0) {
        appointmentData.attendees = details.attendees;
    }

    // Google Calendar Integration
    let calendarSyncSuccess = false;

    try {
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
                timeZone: 'America/Los_Angeles',
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: 'America/Los_Angeles',
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
            conferenceDataVersion: 1,
            sendUpdates: 'all',
            requestBody: eventResource
        });

        // Extract event ID
        appointmentData.googleCalendarEventId = calendarResponse.data.id || null;
        calendarSyncSuccess = true;

        logger.info(`Successfully created Google Calendar event: ${appointmentData.googleCalendarEventId}`);
        appointmentData.calendarSynced = true;

    } catch (error) {
        logger.error(`Failed to sync with Google Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
        appointmentData.calendarSynced = false;
        appointmentData.calendarSyncError = error instanceof Error ? error.message : 'Unknown error';
    }

    // Save appointment to Firestore
    const docRef = await customDb.collection('users').doc(userId).collection('appointments').add(appointmentData);

    // Update the document with its ID for iOS compatibility
    const clientData: any = {
        id: docRef.id,
        title: appointmentData.title,
        date: appointmentData.date,
        time: appointmentData.time
    };

    // Add optional fields only if they exist
    if (appointmentData.duration) {
        clientData.duration = appointmentData.duration;
    }
    if (appointmentData.attendees) {
        clientData.attendees = appointmentData.attendees;
    }

    // Update document with client-compatible data
    await docRef.update(clientData);

    // Return response based on calendar sync status
    if (calendarSyncSuccess) {
        return {
            success: true,
            message: llmResponseMessage || `Appointment "${appointmentTitle}" scheduled successfully and synced with Google Calendar.`,
            intent: 'schedule_appointment',
            details: details
        };
    } else {
        return {
            success: true,
            message: llmResponseMessage || `Appointment "${appointmentTitle}" scheduled successfully in the app only. Failed to sync with Google Calendar.`,
            intent: 'schedule_appointment',
            details: details
        };
    }
}

/**
 * Set user availability
 */
async function setAvailability(userId: string, details: any, llmResponseMessage: string): Promise<any> {
    if (Object.keys(details).length === 0) {
        throw new Error('Missing details for setting availability.');
    }

    await customDb.collection('users').doc(userId).collection('availability').doc('userAvailability').set(details, { merge: true });

    return {
        success: true,
        message: llmResponseMessage || "Your availability has been updated.",
        intent: 'set_availability',
        details: details
    };
}

/**
 * Cancel appointments
 */
async function cancelAppointments(userId: string, details: any): Promise<any> {
    if (!details.date || (!details.title && (!details.attendees || details.attendees.length === 0))) {
        throw new Error('Missing or invalid details for cancelling an appointment. Need either a title or attendees to identify the appointment.');
    }

    // Query Firestore to find appointments to cancel
    const appointmentsToCancelQuery = await customDb.collection('users').doc(userId).collection('appointments')
        .where('date', '==', details.date)
        .get();

    let cancelledCount = 0;
    let availableAppointments: any[] = [];
    let suggestedMatches: string[] = [];
    let appointmentsToDeleteFromGCal: { id: string; googleCalendarEventId: string }[] = [];

    if (!appointmentsToCancelQuery.empty) {
        const batch = customDb.batch();

        // First pass: collect all appointments and find matches
        appointmentsToCancelQuery.docs.forEach(docSnap => {
            try {
                const appointmentData = docSnap.data();

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

                const timeMatch = details.time && appointmentData.time === details.time;

                const attendeeMatch = details.attendees && details.attendees.length > 0 &&
                    appointmentData.attendees && appointmentData.attendees.some((attendee: string) =>
                        details.attendees.some((searchAttendee: string) =>
                            attendee.toLowerCase().includes(searchAttendee.toLowerCase())
                        )
                    );

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
                    batch.delete(docSnap.ref);

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

                    const deletePromises = appointmentsToDeleteFromGCal.map(async (apt) => {
                        try {
                            await calendar.events.delete({
                                calendarId: 'primary',
                                eventId: apt.googleCalendarEventId,
                                sendUpdates: 'all'
                            });
                            logger.info(`Successfully deleted Google Calendar event: ${apt.googleCalendarEventId}`);
                            return { success: true, id: apt.id };
                        } catch (error) {
                            logger.error(`Failed to delete Google Calendar event ${apt.googleCalendarEventId}:`, error);
                            return { success: false, id: apt.id, error };
                        }
                    });

                    const results = await Promise.all(deletePromises);
                    const successfulDeletes = results.filter(r => r.success).length;

                    if (successfulDeletes > 0) {
                        logger.info(`Successfully deleted ${successfulDeletes} events from Google Calendar`);
                    }
                } catch (error) {
                    logger.error("Error deleting events from Google Calendar:", error);
                }
            }
        } else {
            // No exact matches found - provide smart suggestions
            if (details.title) {
                availableAppointments.forEach(apt => {
                    try {
                        const similarity = calculateSimilarity(details.title.toLowerCase(), apt.title.toLowerCase());
                        if (similarity > 0.3) {
                            suggestedMatches.push(`${apt.title} at ${apt.time}${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}`);
                        }
                    } catch (error) {
                        logger.error("Error calculating similarity for appointment:", apt.title, error);
                        suggestedMatches.push(`${apt.title} at ${apt.time}${apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : ''}`);
                    }
                });
            }
        }
    }

    if (cancelledCount > 0) {
        const countText = cancelledCount === 1 ? "appointment" : "appointments";
        const safeTitle = details.title || "appointment";
        return {
            success: true,
            message: `Successfully cancelled ${cancelledCount} ${countText} matching "${safeTitle}" on ${details.date}.`,
            intent: 'cancel_appointment',
            details: details
        };
    } else {
        if (suggestedMatches.length > 0) {
            const safeTitle = details.title || "appointment";
            return {
                success: false,
                message: `No exact match found for "${safeTitle}". Did you mean one of these? ${suggestedMatches.join(', ')}`,
                intent: 'cancel_appointment',
                details: details
            };
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
            return {
                success: false,
                message: `No appointments found matching "${safeTitle}". Available appointments on ${details.date}: ${appointmentList}`,
                intent: 'cancel_appointment',
                details: details
            };
        } else {
            return {
                success: false,
                message: `No appointments found on ${details.date}.`,
                intent: 'cancel_appointment',
                details: details
            };
        }
    }
}

/**
 * Get appointments for a date range
 */
async function getAppointments(userId: string, details: any, llmResponseMessage: string): Promise<any> {
    if (!details.start_date) {
        throw new Error('Missing start date for getting appointments.');
    }

    const startDate = details.start_date;
    const endDate = details.end_date || details.start_date;

    const appointmentsQuery = await customDb.collection('users').doc(userId).collection('appointments')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date')
        .orderBy('time')
        .get();

    const appointments: any[] = [];
    appointmentsQuery.forEach(doc => {
        const appointmentData = doc.data();
        // Return only basic fields
        const appointment: any = {
            id: appointmentData.id || doc.id, // Use stored id or fallback to document id
            title: appointmentData.title,
            date: appointmentData.date,
            time: appointmentData.time
        };

        // Add optional fields only if they exist
        if (appointmentData.duration) {
            appointment.duration = appointmentData.duration;
        }
        if (appointmentData.attendees) {
            appointment.attendees = appointmentData.attendees;
        }

        appointments.push(appointment);
    });

    if (appointments.length > 0) {
        const appointmentsSummary = appointments.map(apt => {
            const attendeesText = apt.attendees && apt.attendees.length > 0 ? ` with ${apt.attendees.join(', ')}` : '';
            const durationText = apt.duration ? ` (${apt.duration} minutes)` : '';
            return `${apt.title} on ${apt.date} at ${apt.time}${durationText}${attendeesText}`;
        }).join('; ');

        return {
            success: true,
            message: llmResponseMessage || `You have ${appointments.length} appointment(s): ${appointmentsSummary}`,
            intent: 'get_appointments',
            details: details,
            appointments: appointments // Already contains only iOS-compatible fields
        };
    } else {
        return {
            success: true,
            message: llmResponseMessage || `No appointments found from ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''}.`,
            intent: 'get_appointments',
            details: details,
            appointments: []
        };
    }
}

/**
 * Process voice command using AI and perform scheduling operations
 * This is a Callable function that can be called directly from client apps
 */
export const processVoiceCommand = onCall({ secrets: [OPENAI_API_KEY2] }, async (request) => {
    const { data, auth } = request;

    // --- FIREBASE AUTHENTICATION ---
    const userId = validateUserAuth(auth);
    logger.info(`Processing command for authenticated user: ${userId}`);

    const userCommandText = validateCommand(data.command);
    logger.info(`Processing command for user ${userId}: "${userCommandText}"`);

    try {
        // --- AI PROCESSING ---
        const llmResponse = await processCommandWithAI(userCommandText);
        logger.info("Parsed LLM Response:", JSON.stringify(llmResponse));

        const { intent, details, llm_response_message } = llmResponse;

        // --- INTENT-BASED DISPATCH ---
        switch (intent) {
            case "schedule_appointment":
                return await scheduleAppointment(userId, details, llm_response_message);

            case "set_availability":
                return await setAvailability(userId, details, llm_response_message);

            case "cancel_appointment":
                return await cancelAppointments(userId, details);

            case "get_appointments":
                return await getAppointments(userId, details, llm_response_message);

            case "unclear":
                return {
                    success: false,
                    message: llm_response_message || "I didn't understand that command. Please try again with a clear instruction to schedule, set availability, cancel, or get appointments.",
                    intent: intent,
                    details: details
                };

            default:
                return {
                    success: false,
                    message: "Unknown intent detected by the system. Please try again.",
                    intent: intent,
                    details: details
                };
        }

    } catch (error) {
        logger.error("Error during voice command processing:", error);
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

        // Create user document if it doesn't exist
        await createUserIfNotExists(userId);

        // 3. Retrieve Google OAuth credentials - hardcoded for testing
        const clientId = "73003602008-0jgk8u5h4s4pdu3010utqovs0kb14fgb.apps.googleusercontent.com";
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

/**
 * Connect Google Calendar Function
 * Verifies calendar access for Google Sign-In users
 */
export const connectGoogleCalendar = onCall(async (request) => {
    const { auth } = request;

    try {
        // Validate user authentication
        if (!auth) {
            throw new Error('User must be authenticated');
        }

        const userId = auth.uid;

        // Verify the user exists and has Google account
        const userDoc = await customDb.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            throw new Error('User not found. Please sign in first.');
        }

        const userData = userDoc.data();
        if (userData?.authProvider !== 'google') {
            throw new Error('Google Calendar connection requires Google Sign-In');
        }

        logger.info(`Checking Google Calendar access for user: ${userId}`);

        // Check if user has refresh token
        const tokenDoc = await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .get();

        if (tokenDoc.exists && tokenDoc.data()?.refresh_token) {
            // User has refresh token - verify calendar access
            try {
                const oAuth2Client = await getGoogleOAuth2Client(userId);

                // Test calendar access
                const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
                await calendar.calendarList.list();

                // Update user document with calendar connection status
                await customDb.collection('users').doc(userId).update({
                    calendarConnected: true,
                    calendarConnectedAt: FieldValue.serverTimestamp(),
                    lastCalendarSync: FieldValue.serverTimestamp()
                });

                return {
                    isAuthenticated: true,
                    message: "Google Calendar is connected and accessible"
                };
            } catch (error) {
                logger.error(`Calendar access failed for user ${userId}:`, error);
                return {
                    isAuthenticated: false,
                    message: "Calendar access failed. Please sign in again with Google.",
                    needsReauth: true
                };
            }
        } else {
            return {
                isAuthenticated: false,
                message: "No calendar access token found. Please sign in with Google and grant calendar permissions.",
                needsReauth: true
            };
        }

    } catch (error) {
        logger.error(`Error checking Google Calendar access for user ${auth?.uid}:`, error);
        throw new Error(`Failed to check Google Calendar access: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});

// Removed beforeUserCreate blocking function - requires GCIP (Google Cloud Identity Platform)
// User documents are now created manually in other functions when needed

/**
 * Save user refresh token for offline access
 */
async function saveUserRefreshToken(userId: string, refreshToken: string, provider: string) {
    try {
        const tokenData = {
            refresh_token: refreshToken,
            provider: provider,
            user_id: userId,
            created_at: FieldValue.serverTimestamp(),
            last_updated: FieldValue.serverTimestamp()
        };

        await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .set(tokenData, { merge: true });

        logger.info(`✅ Refresh token saved for user: ${userId}`);
    } catch (error) {
        logger.error(`Error saving refresh token for user ${userId}:`, error);
    }
}

// Removed unused setupGoogleCalendarIntegration function

// Enhanced function to check if a user already has valid tokens
export const checkGoogleCalendarAuth = onCall(async (request) => {
    const { auth } = request;

    try {
        // Validate user authentication
        if (!auth) {
            logger.error('checkGoogleCalendarAuth: No authentication provided');
            return {
                isAuthenticated: false,
                error: 'User must be authenticated',
                message: 'Please sign in first'
            };
        }

        const userId = auth.uid;
        logger.info(`Checking Google Calendar auth status for user: ${userId}`);

        // Verify the user exists and has Google account
        const userDoc = await customDb.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            logger.info(`User document not found for user: ${userId}`);
            return {
                isAuthenticated: false,
                error: 'User not found',
                message: 'Please sign in first',
                needsReauth: true
            };
        }

        const userData = userDoc.data();
        if (userData?.authProvider !== 'google') {
            logger.info(`User ${userId} is not signed in with Google. Auth provider: ${userData?.authProvider}`);
            return {
                isAuthenticated: false,
                error: 'Google Calendar connection requires Google Sign-In',
                message: 'Please sign in with Google to connect calendar',
                needsReauth: true
            };
        }

        // Check if tokens exist in Firestore
        const tokenDoc = await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .get();

        if (!tokenDoc.exists || !tokenDoc.data()?.refresh_token) {
            // User needs to authenticate - generate auth URL
            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                REDIRECT_URI
            );

            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                prompt: 'consent', // Force to get refresh token
                scope: [
                    'https://www.googleapis.com/auth/calendar.events',
                    'https://www.googleapis.com/auth/userinfo.profile',
                    'https://www.googleapis.com/auth/userinfo.email'
                ],
                state: userId // Pass user ID as state
            });

            return {
                isAuthenticated: false,
                authUrl: authUrl,
                message: "Please complete Google Calendar authorization"
            };
        }

        // User already has tokens - validate and refresh if needed
        try {
            const oAuth2Client = await getGoogleOAuth2Client(userId);

            // Check token expiration
            const tokenData = tokenDoc.data();
            const now = Date.now();
            const tokenExpiry = tokenData?.expiry_date;
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (tokenExpiry && now + fiveMinutesInMs >= tokenExpiry) {
                logger.info(`Tokens expiring soon for user ${userId}, refreshing...`);

                // Refresh tokens automatically
                const refreshResponse = await oAuth2Client.refreshAccessToken();
                const newTokens = refreshResponse.credentials;

                // Update tokens in Firestore
                await customDb
                    .collection('artifacts')
                    .doc(APP_ID)
                    .collection('users')
                    .doc(userId)
                    .collection('tokens')
                    .doc('googleCalendar')
                    .update({
                        access_token: newTokens.access_token,
                        expiry_date: newTokens.expiry_date,
                        last_updated: FieldValue.serverTimestamp()
                    });

                logger.info(`✅ Tokens refreshed successfully for user: ${userId}`);
            }

            return {
                isAuthenticated: true,
                message: "Google Calendar is connected",
                tokensValid: true,
                lastUpdated: tokenData?.last_updated
            };

        } catch (error) {
            // Token refresh failed or other issue
            logger.error(`Token validation failed for user ${userId}:`, error);

            // Generate new auth URL
            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                REDIRECT_URI
            );

            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                prompt: 'consent',
                scope: [
                    'https://www.googleapis.com/auth/calendar.events',
                    'https://www.googleapis.com/auth/userinfo.profile',
                    'https://www.googleapis.com/auth/userinfo.email'
                ],
                state: userId
            });

            return {
                isAuthenticated: false,
                authUrl: authUrl,
                error: error instanceof Error ? error.message : "Unknown error",
                needsReauth: true
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error checking Google Calendar auth for user ${auth?.uid || 'unknown'}:`, error);

        return {
            isAuthenticated: false,
            error: errorMessage,
            message: `Failed to check Google Calendar authentication: ${errorMessage}`,
            needsReauth: true
        };
    }
});

/**
 * Google Sign-In Authentication Function
 * Handles Google Sign-In with calendar access and creates/updates user in Firestore
 */
export const googleSignIn = onCall(async (request) => {
    const { data } = request;
    const { googleIdToken, accessToken, refreshToken } = data;

    try {
        // Validate input
        if (!googleIdToken) {
            throw new Error('Google ID token is required');
        }

        // Verify Google ID token server-side
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken: googleIdToken,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        if (!payload) {
            throw new Error('Invalid Google ID token');
        }

        const googleUserId = payload.sub;
        const email = payload.email;
        const name = payload.name;
        const picture = payload.picture;

        logger.info(`Google Sign-In verified for user: ${googleUserId}, email: ${email}`);

        // Create or update user in Firestore
        const userDocRef = customDb.collection('users').doc(googleUserId);
        const userDoc = await userDocRef.get();

        let isNewUser = false;
        let userData;

        if (!userDoc.exists) {
            // Create new user
            userData = {
                userId: googleUserId,
                email: email,
                name: name,
                picture: picture,
                googleAccessToken: accessToken,
                createdAt: FieldValue.serverTimestamp(),
                lastLogin: FieldValue.serverTimestamp(),
                status: 'active',
                authProvider: 'google'
            };

            await userDocRef.set(userData);
            isNewUser = true;
            logger.info(`Created new user: ${googleUserId}`);
        } else {
            // Update existing user
            userData = {
                ...userDoc.data(),
                lastLogin: FieldValue.serverTimestamp(),
                googleAccessToken: accessToken,
                email: email,
                name: name,
                picture: picture
            };

            await userDocRef.update({
                lastLogin: FieldValue.serverTimestamp(),
                googleAccessToken: accessToken,
                email: email,
                name: name,
                picture: picture
            });

            logger.info(`Updated existing user: ${googleUserId}`);
        }

        // Store refresh token for calendar access
        if (refreshToken) {
            await saveUserRefreshToken(googleUserId, refreshToken, 'google.com');
            logger.info(`✅ Refresh token stored for user: ${googleUserId}`);
        }

        return {
            success: true,
            userId: googleUserId,
            isNewUser: isNewUser,
            userData: userData,
            hasRefreshToken: !!refreshToken
        };

    } catch (error) {
        logger.error('Error in Google Sign-In:', error);
        throw new Error(`Google Sign-In failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});

/**
 * Refresh Google Tokens Function
 * Refreshes expired Google tokens for Google Sign-In users
 */
export const refreshGoogleTokens = onCall(async (request) => {
    const { auth } = request;

    try {
        // Validate user authentication
        if (!auth) {
            throw new Error('User must be authenticated');
        }

        const userId = auth.uid;

        // Verify the user exists and has Google account
        const userDoc = await customDb.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            throw new Error('User not found. Please sign in first.');
        }

        const userData = userDoc.data();
        if (userData?.authProvider !== 'google') {
            throw new Error('Token refresh requires Google Sign-In');
        }

        logger.info(`Refreshing Google tokens for user: ${userId}`);

        // Check if user has calendar tokens
        const tokenDoc = await customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar')
            .get();

        if (!tokenDoc.exists || !tokenDoc.data()?.refresh_token) {
            throw new Error('No Google Calendar tokens found. Please connect your calendar first.');
        }

        // Try to refresh tokens
        try {
            await getGoogleOAuth2Client(userId);

            // The getGoogleOAuth2Client function already handles token refresh
            // If we get here, tokens are valid
            return {
                isRefreshed: true,
                message: "Tokens are valid and up to date"
            };

        } catch (error) {
            logger.error(`Token refresh failed for user ${userId}:`, error);

            // If refresh failed, user needs to re-authenticate
            return {
                isRefreshed: false,
                needsReauth: true,
                error: error instanceof Error ? error.message : 'Unknown error',
                message: "Tokens are expired. Please reconnect your Google Calendar."
            };
        }

    } catch (error) {
        logger.error(`Error refreshing tokens for user ${auth?.uid}:`, error);
        throw new Error(`Failed to refresh tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});

/**
 * Store Google Calendar Authentication Tokens
 * Securely stores access tokens and refresh tokens with proper validation
 */
export const storeGoogleCalendarAuth = onCall(async (request) => {
    const { data, auth } = request;

    try {
        // Validate user authentication
        if (!auth) {
            logger.error('storeGoogleCalendarAuth: No authentication provided');
            throw new Error('User must be authenticated');
        }

        const userId = auth.uid;
        logger.info(`Storing Google Calendar tokens for user: ${userId}`);
        logger.info(`Received data keys: ${Object.keys(data || {}).join(', ')}`);

        // Extract and validate required parameters
        const {
            accessToken,
            refreshToken,
            expiryDate,
            scopes,
            name,
            email
        } = data || {};

        // Enhanced validation with specific error messages
        if (!accessToken) {
            logger.error('storeGoogleCalendarAuth: Missing accessToken');
            throw new Error('Access token is required for calendar integration');
        }

        if (!refreshToken) {
            logger.error('storeGoogleCalendarAuth: Missing refreshToken');
            throw new Error('Refresh token is required for offline access');
        }

        if (!email) {
            logger.error('storeGoogleCalendarAuth: Missing email');
            throw new Error('Email is required for user identification');
        }

        // Create or update user document with provided data
        const userDoc = await customDb.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            // Create user document with provided information
            const newUserData = {
                userId: userId,
                email: email,
                name: name || 'Unknown',
                authProvider: 'google',
                createdAt: FieldValue.serverTimestamp(),
                lastLogin: FieldValue.serverTimestamp(),
                status: 'active'
            };

            await customDb.collection('users').doc(userId).set(newUserData);
            logger.info(`Created new user document for: ${userId}`);
        } else {
            // Update existing user document
            const updateData: any = {
                email: email,
                lastLogin: FieldValue.serverTimestamp()
            };

            if (name) {
                updateData.name = name;
            }

            // Only update authProvider if not already set or if it's different
            const userData = userDoc.data();
            if (!userData?.authProvider || userData.authProvider !== 'google') {
                updateData.authProvider = 'google';
            }

            await customDb.collection('users').doc(userId).update(updateData);
            logger.info(`Updated existing user document for: ${userId}`);
        }

        // Process token expiration
        const now = Date.now();
        let tokenExpiry: number | null = null;

        if (expiryDate) {
            // Handle different expiry date formats
            if (typeof expiryDate === 'number') {
                tokenExpiry = expiryDate;
            } else if (typeof expiryDate === 'string') {
                tokenExpiry = new Date(expiryDate).getTime();
            }

            if (tokenExpiry && isNaN(tokenExpiry)) {
                logger.warn(`Invalid expiry date format: ${expiryDate}, using current time + 1 hour`);
                tokenExpiry = now + (60 * 60 * 1000); // 1 hour from now
            }
        } else {
            // Default to 1 hour if no expiry provided
            tokenExpiry = now + (60 * 60 * 1000);
            logger.info('No expiry date provided, defaulting to 1 hour from now');
        }

        if (tokenExpiry && tokenExpiry <= now) {
            logger.warn(`Access token has already expired (${new Date(tokenExpiry).toISOString()}), but proceeding with storage for refresh token use`);
        }

        // Prepare token data
        const tokenData = {
            access_token: accessToken,
            refresh_token: refreshToken,
            expiry_date: tokenExpiry,
            scopes: scopes || [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/calendar.readonly',
                'https://www.googleapis.com/auth/calendar'
            ],
            last_updated: FieldValue.serverTimestamp(),
            user_id: userId,
            auth_provider: 'google',
            token_version: '1.1', // Updated version
            is_encrypted: false // Firebase automatically encrypts at rest
        };

        // Store tokens in Firestore with proper path structure
        const tokenDocRef = customDb
            .collection('artifacts')
            .doc(APP_ID)
            .collection('users')
            .doc(userId)
            .collection('tokens')
            .doc('googleCalendar');

        logger.info(`Storing tokens at path: ${tokenDocRef.path}`);
        await tokenDocRef.set(tokenData, { merge: true });

        // Verify the document was created
        const verifyDoc = await tokenDocRef.get();
        if (!verifyDoc.exists) {
            logger.error('Failed to create token document after set operation');
            throw new Error('Failed to store tokens in Firestore - document not created');
        }

        const storedData = verifyDoc.data();
        logger.info(`✅ Token document created successfully. Keys: ${Object.keys(storedData || {}).join(', ')}`);

        // Update user document with calendar connection status
        await customDb.collection('users').doc(userId).update({
            calendarConnected: true,
            calendarConnectedAt: FieldValue.serverTimestamp(),
            lastCalendarSync: FieldValue.serverTimestamp()
        });

        logger.info(`✅ Successfully stored Google Calendar tokens for user: ${userId}`);

        return {
            success: true,
            message: "Google Calendar tokens stored successfully",
            userId: userId,
            tokenStored: true,
            expiryDate: tokenExpiry,
            tokenPath: tokenDocRef.path
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error(`❌ Error storing Google Calendar tokens for user ${auth?.uid || 'unknown'}:`, error);

        // Return a structured error response instead of throwing
        return {
            success: false,
            message: `Failed to store Google Calendar tokens: ${errorMessage}`,
            error: errorMessage,
            userId: auth?.uid || null
        };
    }
});

// Add this function to create user document when they first authenticate
async function createUserIfNotExists(userId: string) {
    try {
        const userDoc = await customDb.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            // Create user document
            await customDb.collection('users').doc(userId).set({
                userId: userId,
                createdAt: FieldValue.serverTimestamp(),
                lastLogin: FieldValue.serverTimestamp(),
                status: 'active'
            });

            logger.info(`Created new user document for: ${userId}`);
        } else {
            // Update last login
            await customDb.collection('users').doc(userId).update({
                lastLogin: FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        logger.error(`Error creating/updating user document for ${userId}:`, error);
    }
}

/**
 * Simple test function to verify OpenAI API key is working
 * This function doesn't require authentication for easy testing
 */
export const testOpenAI = onRequest({ secrets: [OPENAI_API_KEY2] }, async (req, res) => {
    try {
        logger.info("Testing OpenAI API connection...");

        if (!OPENAI_API_KEY2.value()) {
            logger.error("OpenAI API key not configured");
            res.status(500).json({ error: "API key not configured" });
            return;
        }

        const testResponse = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY2.value()}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: "Hello, this is a test" }],
                max_tokens: 10
            })
        });

        if (!testResponse.ok) {
            const errorBody = await testResponse.text();
            logger.error(`OpenAI API error: ${testResponse.status}, body: ${errorBody}`);
            res.status(500).json({ error: "OpenAI API failed", details: errorBody });
            return;
        }

        const result = await testResponse.json();
        logger.info("OpenAI API test successful!");
        res.json({ success: true, message: "OpenAI API key is working!", result: result });

    } catch (error) {
        logger.error("Error testing OpenAI API:", error);
        res.status(500).json({ error: "Test failed", details: error instanceof Error ? error.message : String(error) });
    }
}); 