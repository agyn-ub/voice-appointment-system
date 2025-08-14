/**
 * Firebase Testing Setup
 * Initializes Firebase Admin SDK and provides utility functions for testing
 */

const admin = require('firebase-admin');
const colors = require('colors');
const path = require('path');

// Configuration
const SERVICE_ACCOUNT_PATH = '../../service_account.json';
const TEST_USER_ID = 'ZgTo1onlYoZCmK7zXCyMbPf1Bwf1'; // Replace with actual UID from service_account.json

class FirebaseTestSetup {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    /**
     * Initialize Firebase Admin SDK
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            console.log(colors.blue('🔧 Initializing Firebase Admin SDK...'));

            // Initialize Firebase Admin
            const serviceAccount = require(SERVICE_ACCOUNT_PATH);

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id
            });

            this.db = admin.firestore();
            this.initialized = true;

            console.log(colors.green('✅ Firebase Admin SDK initialized successfully'));
            console.log(colors.cyan(`📋 Project ID: ${serviceAccount.project_id}`));
            console.log(colors.cyan(`👤 Test User ID: ${TEST_USER_ID}`));

        } catch (error) {
            console.error(colors.red('❌ Failed to initialize Firebase Admin SDK:'), error);
            throw error;
        }
    }

    /**
     * Call Firebase callable function using Admin SDK
     */
    async callFunction(functionName, data, uid = TEST_USER_ID) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            console.log(colors.yellow(`📞 Calling function: ${functionName}`));
            console.log(colors.gray(`📝 Data: ${JSON.stringify(data, null, 2)}`));

            // Create a custom token for the test user
            const customToken = await admin.auth().createCustomToken(uid);

            // Sign in with custom token to get ID token
            const firebase = require('firebase/app');
            const { getAuth, signInWithCustomToken } = require('firebase/auth');
            const { getFunctions, httpsCallable } = require('firebase/functions');

            // Initialize Firebase client SDK with correct configuration
            const firebaseConfig = {
                projectId: "learning-auth-e6ea2",
                apiKey: "AIzaSyC5PG9BVR7-nCrASlaqeBBICYHKklGtmGo",
                authDomain: "learning-auth-e6ea2.firebaseapp.com",
                storageBucket: "learning-auth-e6ea2.firebasestorage.app",
                messagingSenderId: "73003602008"
            };

            if (!firebase.getApps().length) {
                firebase.initializeApp(firebaseConfig);
            }

            const auth = getAuth();
            const functions = getFunctions();

            // Sign in with custom token
            const userCredential = await signInWithCustomToken(auth, customToken);
            console.log(colors.cyan(`🔐 Authenticated as: ${userCredential.user.uid}`));

            // Call the function
            const callable = httpsCallable(functions, functionName);
            const result = await callable(data);

            console.log(colors.green(`✅ Function call successful`));
            console.log(colors.gray(`📤 Result: ${JSON.stringify(result.data, null, 2)}`));

            return result.data;

        } catch (error) {
            console.error(colors.red(`❌ Function call failed:`), error);
            throw error;
        }
    }

    /**
     * Get appointments from Firestore directly
     */
    async getAppointments(userId = TEST_USER_ID, dateFilter = null) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            console.log(colors.blue(`📅 Reading appointments for user: ${userId}`));

            let query = this.db
                .collection('users')
                .doc(userId)
                .collection('appointments');

            if (dateFilter) {
                query = query.where('date', '==', dateFilter);
            }

            const snapshot = await query.get();
            const appointments = [];

            snapshot.forEach(doc => {
                appointments.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(colors.green(`✅ Found ${appointments.length} appointments`));
            return appointments;

        } catch (error) {
            console.error(colors.red(`❌ Failed to read appointments:`), error);
            throw error;
        }
    }

    /**
     * Get Google Calendar tokens from Firestore
     */
    async getGoogleTokens(userId = TEST_USER_ID) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            console.log(colors.blue(`🔑 Reading Google tokens for user: ${userId}`));

            const tokenDoc = await this.db
                .collection('artifacts')
                .doc('my-voice-calendly-app')
                .collection('users')
                .doc(userId)
                .collection('tokens')
                .doc('googleCalendar')
                .get();

            if (!tokenDoc.exists) {
                throw new Error('No Google Calendar tokens found');
            }

            const tokens = tokenDoc.data();
            console.log(colors.green('✅ Google tokens retrieved successfully'));
            console.log(colors.gray(`📧 Email: ${tokens.email || 'N/A'}`));
            console.log(colors.gray(`⏰ Expires: ${new Date(tokens.expiry_date).toISOString()}`));

            return tokens;

        } catch (error) {
            console.error(colors.red(`❌ Failed to read Google tokens:`), error);
            throw error;
        }
    }

    /**
     * Clean up test data (optional)
     */
    async cleanup(userId = TEST_USER_ID) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            console.log(colors.yellow(`🧹 Cleaning up test data for user: ${userId}`));

            // Delete test appointments
            const appointmentsRef = this.db
                .collection('users')
                .doc(userId)
                .collection('appointments');

            const snapshot = await appointmentsRef.get();
            const batch = this.db.batch();

            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            console.log(colors.green(`✅ Cleaned up ${snapshot.docs.length} test appointments`));

        } catch (error) {
            console.error(colors.red(`❌ Cleanup failed:`), error);
            throw error;
        }
    }
}

// Export singleton instance
const testSetup = new FirebaseTestSetup();

// Helper functions
const formatDate = (daysFromToday = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);
    return date.toISOString().split('T')[0];
};

const formatTime = (hour = 14, minute = 0) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

module.exports = {
    testSetup,
    TEST_USER_ID,
    formatDate,
    formatTime,
    colors
};