const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkUserTokens(userId) {
    try {
        console.log(`🔍 Checking tokens for user: ${userId}`);

        const tokenPath = `artifacts/my-voice-calendly-app/users/${userId}/tokens/googleCalendar`;
        console.log(`📁 Checking path: ${tokenPath}`);

        const tokenDoc = await db.doc(tokenPath).get();

        if (tokenDoc.exists) {
            const data = tokenDoc.data();
            console.log('✅ Token document found!');
            console.log('📋 Document data:');
            console.log('- Has access_token:', !!data.access_token);
            console.log('- Has refresh_token:', !!data.refresh_token);
            console.log('- Expiry date:', data.expiry_date);
            console.log('- Scopes:', data.scopes);
            console.log('- Last updated:', data.last_updated);
        } else {
            console.log('❌ Token document NOT found');
        }

        // Also check if the user document exists
        const userPath = `artifacts/my-voice-calendly-app/users/${userId}`;
        const userDoc = await db.doc(userPath).get();
        console.log(`👤 User document exists: ${userDoc.exists}`);

    } catch (error) {
        console.error('❌ Error checking tokens:', error);
    }
}

// Check for the user ID from the logs
const userId = '8AX4qcEBr0cSY14Cjw3Soak0ShI2';
checkUserTokens(userId); 