/**
 * Voice Command Testing
 * Tests various voice command scenarios through Firebase functions
 */

const { testSetup, TEST_USER_ID, formatDate, formatTime, colors } = require('./test-setup');

class VoiceCommandTests {
    constructor() {
        this.testResults = [];
        this.googleCalendarToken = null;
    }

    /**
     * Run a test and track results
     */
    async runTest(testName, testFunction) {
        console.log(colors.blue(`\n🧪 Running test: ${testName}`));
        console.log(colors.gray('─'.repeat(50)));
        
        try {
            const startTime = Date.now();
            await testFunction();
            const duration = Date.now() - startTime;
            
            this.testResults.push({
                name: testName,
                status: 'PASS',
                duration: `${duration}ms`
            });
            
            console.log(colors.green(`✅ PASS - ${testName} (${duration}ms)`));
            
        } catch (error) {
            this.testResults.push({
                name: testName,
                status: 'FAIL',
                error: error.message
            });
            
            console.error(colors.red(`❌ FAIL - ${testName}`));
            console.error(colors.red(`   Error: ${error.message}`));
        }
    }

    /**
     * Test appointment scheduling
     */
    async testScheduleAppointment() {
        const tomorrow = formatDate(1);
        const time = formatTime(14, 30); // 2:30 PM
        
        const command = `Schedule meeting with John tomorrow at 2:30pm`;
        
        const result = await testSetup.callFunction('processVoiceCommand', {
            command: command,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        // Verify response
        if (!result.success) {
            throw new Error(`Function returned failure: ${result.message}`);
        }

        // Check if appointment was created in Firestore
        const appointments = await testSetup.getAppointments(TEST_USER_ID, tomorrow);
        const johnMeeting = appointments.find(apt => 
            apt.title.toLowerCase().includes('john') && 
            apt.time === time
        );

        if (!johnMeeting) {
            throw new Error('Appointment not found in Firestore');
        }

        console.log(colors.cyan(`   📅 Created: ${johnMeeting.title} on ${johnMeeting.date} at ${johnMeeting.time}`));
    }

    /**
     * Test personal event creation
     */
    async testCreatePersonalEvent() {
        const friday = formatDate(5);
        const time = formatTime(18, 0); // 6:00 PM
        
        const command = `Remind me to go to gym on Friday at 6pm`;
        
        const result = await testSetup.callFunction('processVoiceCommand', {
            command: command,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        // Verify response
        if (!result.success) {
            throw new Error(`Function returned failure: ${result.message}`);
        }

        // Check if personal event was created
        const appointments = await testSetup.getAppointments(TEST_USER_ID, friday);
        const gymEvent = appointments.find(apt => 
            apt.title.toLowerCase().includes('gym') && 
            apt.type === 'personal_event'
        );

        if (!gymEvent) {
            throw new Error('Personal event not found in Firestore');
        }

        console.log(colors.cyan(`   🏃 Created: ${gymEvent.title} on ${gymEvent.date} at ${gymEvent.time}`));
    }

    /**
     * Test appointment retrieval
     */
    async testGetAppointments() {
        const today = formatDate(0);
        
        const command = `What meetings do I have today?`;
        
        const result = await testSetup.callFunction('processVoiceCommand', {
            command: command,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        // Verify response
        if (!result.success) {
            throw new Error(`Function returned failure: ${result.message}`);
        }

        console.log(colors.cyan(`   📋 Response: ${result.message}`));
        
        // Should contain appointment information
        if (!result.message.toLowerCase().includes('appointment')) {
            console.log(colors.yellow(`   ⚠️  Note: No appointments mentioned in response (this may be expected)`));
        }
    }

    /**
     * Test appointment cancellation
     */
    async testCancelAppointment() {
        // First create an appointment to cancel
        const tomorrow = formatDate(1);
        const time = formatTime(10, 0); // 10:00 AM
        
        const createCommand = `Schedule meeting with Sarah tomorrow at 10am`;
        
        const createResult = await testSetup.callFunction('processVoiceCommand', {
            command: createCommand,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        if (!createResult.success) {
            throw new Error(`Failed to create appointment for cancellation test: ${createResult.message}`);
        }

        // Wait a moment for the data to be consistent
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Now cancel it
        const cancelCommand = `Cancel my meeting with Sarah tomorrow`;
        
        const cancelResult = await testSetup.callFunction('processVoiceCommand', {
            command: cancelCommand,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        if (!cancelResult.success) {
            throw new Error(`Function returned failure: ${cancelResult.message}`);
        }

        // Verify appointment was cancelled
        const appointments = await testSetup.getAppointments(TEST_USER_ID, tomorrow);
        const sarahMeeting = appointments.find(apt => 
            apt.title.toLowerCase().includes('sarah') && 
            apt.status === 'cancelled'
        );

        if (!sarahMeeting) {
            throw new Error('Cancelled appointment not found or not marked as cancelled');
        }

        console.log(colors.cyan(`   🚫 Cancelled: ${sarahMeeting.title} on ${sarahMeeting.date}`));
    }

    /**
     * Test error handling with invalid command
     */
    async testErrorHandling() {
        const command = `Schedule meeting with nobody at invalid time on fake date`;
        
        const result = await testSetup.callFunction('processVoiceCommand', {
            command: command,
            timezone: 'America/Los_Angeles',
            googleCalendarToken: this.googleCalendarToken
        });

        // This should either fail gracefully or ask for clarification
        console.log(colors.cyan(`   💬 Response: ${result.message}`));
        
        // The AI should handle this gracefully by asking for clarification
        if (result.success && result.message.toLowerCase().includes('clarif')) {
            console.log(colors.cyan(`   ✨ AI handled ambiguous command well`));
        }
    }

    /**
     * Test Google Calendar integration
     */
    async testGoogleCalendarIntegration() {
        // Check if user has Google Calendar connected
        try {
            const tokens = await testSetup.getGoogleTokens(TEST_USER_ID);
            console.log(colors.cyan(`   🔗 Google Calendar connected: ${tokens.email}`));
            
            // Create an appointment and check for calendar sync
            const tomorrow = formatDate(1);
            const command = `Schedule important meeting tomorrow at 3pm`;
            
            const result = await testSetup.callFunction('processVoiceCommand', {
                command: command,
                timezone: 'America/Los_Angeles',
                googleCalendarToken: this.googleCalendarToken
            });

            if (!result.success) {
                throw new Error(`Function returned failure: ${result.message}`);
            }

            // Check if appointment indicates calendar sync
            if (result.message.includes('synced to Google Calendar')) {
                console.log(colors.cyan(`   📅 Successfully synced to Google Calendar`));
            } else {
                console.log(colors.yellow(`   ⚠️  Calendar sync status unclear from response`));
            }
            
        } catch (error) {
            throw new Error(`Google Calendar integration test failed: ${error.message}`);
        }
    }

    /**
     * Print test results summary
     */
    printResults() {
        console.log(colors.blue('\n📊 TEST RESULTS SUMMARY'));
        console.log(colors.gray('═'.repeat(50)));
        
        const passed = this.testResults.filter(r => r.status === 'PASS').length;
        const failed = this.testResults.filter(r => r.status === 'FAIL').length;
        const total = this.testResults.length;
        
        this.testResults.forEach(result => {
            const status = result.status === 'PASS' 
                ? colors.green('✅ PASS') 
                : colors.red('❌ FAIL');
            const duration = result.duration ? colors.gray(`(${result.duration})`) : '';
            console.log(`${status} ${result.name} ${duration}`);
            
            if (result.error) {
                console.log(colors.red(`     └─ ${result.error}`));
            }
        });
        
        console.log(colors.gray('─'.repeat(50)));
        console.log(`Total: ${total}, Passed: ${colors.green(passed)}, Failed: ${colors.red(failed)}`);
        
        if (failed === 0) {
            console.log(colors.green('\n🎉 All tests passed!'));
        } else {
            console.log(colors.yellow(`\n⚠️  ${failed} test(s) failed`));
        }
    }

    /**
     * Run all voice command tests
     */
    async runAllTests() {
        console.log(colors.blue('🚀 Starting Voice Command Tests'));
        console.log(colors.gray('═'.repeat(50)));
        
        try {
            // Initialize Firebase
            await testSetup.initialize();
            
            // Try to get Google Calendar token for testing
            try {
                const tokens = await testSetup.getGoogleTokens(TEST_USER_ID);
                this.googleCalendarToken = tokens.access_token;
                console.log(colors.cyan(`🔑 Using Google Calendar token for testing`));
            } catch (error) {
                console.log(colors.yellow(`⚠️  No Google Calendar token available - calendar sync will be skipped`));
            }
            
            // Run all tests
            await this.runTest('Schedule Appointment', () => this.testScheduleAppointment());
            await this.runTest('Create Personal Event', () => this.testCreatePersonalEvent());
            await this.runTest('Get Appointments', () => this.testGetAppointments());
            await this.runTest('Cancel Appointment', () => this.testCancelAppointment());
            await this.runTest('Error Handling', () => this.testErrorHandling());
            await this.runTest('Google Calendar Integration', () => this.testGoogleCalendarIntegration());
            
        } catch (error) {
            console.error(colors.red('\n💥 Test suite failed to initialize:'), error);
        }
        
        // Print results
        this.printResults();
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const tests = new VoiceCommandTests();
    tests.runAllTests().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error(colors.red('Test suite crashed:'), error);
        process.exit(1);
    });
}

module.exports = VoiceCommandTests;