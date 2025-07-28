const admin = require('firebase-admin');

// Initialize Firebase Admin (you'll need to download serviceAccountKey.json from Firebase Console)
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.log('❌ Please download serviceAccountKey.json from Firebase Console > Project Settings > Service Accounts');
    console.log('Or run this check from Firebase Console directly');
    process.exit(1);
}

const db = admin.firestore();

async function checkTokens() {
    const userId = '8AX4qcEBr0cSY14Cjw3Soak0ShI2';
    const appId = 'my-voice-calendly-app';

    console.log(`🔍 Checking tokens for user: ${userId}`);
    console.log(`📁 App ID: ${appId}`);

    try {
        // Check the exact path from the function
        const tokenPath = `artifacts/${appId}/users/${userId}/tokens/googleCalendar`;
        console.log(`\n📂 Checking path: ${tokenPath}`);

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

        // Check if user document exists
        const userPath = `artifacts/${appId}/users/${userId}`;
        const userDoc = await db.doc(userPath).get();
        console.log(`\n👤 User document exists: ${userDoc.exists}`);

        // Check if artifacts collection exists
        const artifactsDoc = await db.doc(`artifacts/${appId}`).get();
        console.log(`📦 Artifacts document exists: ${artifactsDoc.exists}`);

    } catch (error) {
        console.error('❌ Error checking tokens:', error);
    }
}

checkTokens(); 