/**
 * Test script for context persistence in voice calendar app
 * Tests that partial appointment data is maintained across multiple messages
 */

const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Firebase configuration (replace with your config)
const firebaseConfig = {
  apiKey: "AIzaSyBvGRNDyMEHGepULSe9V3QHmK5mNJEK95c",
  authDomain: "learning-auth-e6ea2.firebaseapp.com",
  projectId: "learning-auth-e6ea2",
  storageBucket: "learning-auth-e6ea2.appspot.com",
  messagingSenderId: "529040149397",
  appId: "1:529040149397:web:YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
const auth = getAuth(app);

// Test user credentials (replace with your test user)
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_PASSWORD = 'testpassword123';

async function testContextPersistence() {
  console.log('🧪 Testing Voice Calendar Context Persistence\n');
  
  try {
    // Sign in the test user
    console.log('1️⃣ Signing in test user...');
    const userCredential = await signInWithEmailAndPassword(auth, TEST_USER_EMAIL, TEST_USER_PASSWORD);
    console.log('✅ Signed in as:', userCredential.user.email);
    
    // Get the processVoiceCommand function
    const processVoiceCommand = httpsCallable(functions, 'processVoiceCommand');
    
    // Test Case 1: Incomplete doctor appointment
    console.log('\n2️⃣ Test Case 1: Doctor appointment with progressive details');
    
    // First message: Just mention doctor tomorrow
    console.log('   Sending: "I need to visit the doctor tomorrow"');
    let response = await processVoiceCommand({ 
      command: "I need to visit the doctor tomorrow" 
    });
    console.log('   Response:', response.data.message);
    console.log('   Success:', response.data.success);
    
    // Wait a bit to simulate user thinking
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Second message: Provide time
    console.log('\n   Sending: "2 PM works"');
    response = await processVoiceCommand({ 
      command: "2 PM works" 
    });
    console.log('   Response:', response.data.message);
    console.log('   Success:', response.data.success);
    if (response.data.appointment) {
      console.log('   ✅ Appointment created:', response.data.appointment);
    }
    
    // Test Case 2: Meeting with progressive details
    console.log('\n3️⃣ Test Case 2: Meeting with Sarah - progressive details');
    
    // First message: Just mention meeting with Sarah
    console.log('   Sending: "Schedule a meeting with Sarah"');
    response = await processVoiceCommand({ 
      command: "Schedule a meeting with Sarah" 
    });
    console.log('   Response:', response.data.message);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Second message: Provide date
    console.log('\n   Sending: "Next Friday"');
    response = await processVoiceCommand({ 
      command: "Next Friday" 
    });
    console.log('   Response:', response.data.message);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Third message: Provide time
    console.log('\n   Sending: "3 PM"');
    response = await processVoiceCommand({ 
      command: "3 PM" 
    });
    console.log('   Response:', response.data.message);
    if (response.data.appointment) {
      console.log('   ✅ Meeting created:', response.data.appointment);
    }
    
    // Test Case 3: Error recovery
    console.log('\n4️⃣ Test Case 3: Testing error recovery with context');
    
    // Start a cinema appointment
    console.log('   Sending: "Going to cinema"');
    response = await processVoiceCommand({ 
      command: "Going to cinema" 
    });
    console.log('   Response:', response.data.message);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate an interruption/error by sending invalid command
    console.log('\n   Sending: "asdfghjkl" (simulating error)');
    try {
      response = await processVoiceCommand({ 
        command: "asdfghjkl" 
      });
      console.log('   Response:', response.data.message);
    } catch (error) {
      console.log('   Error (expected):', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Resume with date/time
    console.log('\n   Sending: "Saturday at 7 PM"');
    response = await processVoiceCommand({ 
      command: "Saturday at 7 PM" 
    });
    console.log('   Response:', response.data.message);
    if (response.data.appointment) {
      console.log('   ✅ Cinema event created:', response.data.appointment);
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  process.exit(0);
}

// Run the tests
testContextPersistence();