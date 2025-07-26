// Simple script to check if our appointment data exists
const https = require('https');

async function testScheduleAppointment() {
    const functionUrl = 'https://us-central1-learning-auth-e6ea2.cloudfunctions.net/processVoiceCommand';

    const data = JSON.stringify({
        data: {
            command: "Schedule a test meeting for today at 3 PM for 30 minutes"
        }
    });

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(functionUrl, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseData));
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    console.log('🧪 Testing appointment creation to populate database...\n');

    try {
        const result = await testScheduleAppointment();
        console.log('✅ Appointment creation result:');
        console.log(JSON.stringify(result, null, 2));

        console.log('\n📍 Data should now be visible in Firebase Console at:');
        console.log('🔗 https://console.firebase.google.com/project/learning-auth-e6ea2/firestore/data');
        console.log('\n📂 Navigate to:');
        console.log('   users → test-user-id-no-auth → appointments');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main(); 