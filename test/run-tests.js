/**
 * Test Runner
 * Runs all test suites and provides a comprehensive report
 */

const { colors } = require('./test-setup');
const VoiceCommandTests = require('./test-voice-commands');

class TestRunner {
    constructor() {
        this.allResults = [];
    }

    /**
     * Run all test suites
     */
    async runAllTestSuites() {
        console.log(colors.blue('🧪 Voice Calendar Testing Suite'));
        console.log(colors.gray('═'.repeat(60)));
        console.log(colors.cyan('Testing complete voice calendar functionality'));
        console.log(colors.gray('Including: Firebase Functions, Firestore, Google Calendar Integration'));
        console.log(colors.gray('═'.repeat(60)));

        const startTime = Date.now();

        try {
            // Run Voice Command Tests
            console.log(colors.blue('\n📞 Voice Command Tests'));
            const voiceTests = new VoiceCommandTests();
            await voiceTests.runAllTests();
            this.allResults.push({
                suite: 'Voice Commands',
                results: voiceTests.testResults
            });

            // Future: Add more test suites here
            // - Calendar Sync Tests
            // - Data Validation Tests
            // - Error Handling Tests

        } catch (error) {
            console.error(colors.red('\n💥 Test suite execution failed:'), error);
        }

        const totalTime = Date.now() - startTime;
        this.printFinalSummary(totalTime);
    }

    /**
     * Print comprehensive test summary
     */
    printFinalSummary(totalTime) {
        console.log(colors.blue('\n📈 FINAL TEST SUMMARY'));
        console.log(colors.gray('═'.repeat(60)));

        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;

        this.allResults.forEach(suiteResult => {
            const passed = suiteResult.results.filter(r => r.status === 'PASS').length;
            const failed = suiteResult.results.filter(r => r.status === 'FAIL').length;
            const total = suiteResult.results.length;

            console.log(`${colors.cyan(suiteResult.suite)}: ${total} tests, ${colors.green(passed)} passed, ${colors.red(failed)} failed`);

            totalTests += total;
            totalPassed += passed;
            totalFailed += failed;
        });

        console.log(colors.gray('─'.repeat(60)));
        console.log(`${colors.bold('OVERALL')}: ${totalTests} tests, ${colors.green(totalPassed)} passed, ${colors.red(totalFailed)} failed`);
        console.log(colors.gray(`Execution time: ${totalTime}ms`));

        // Final status
        if (totalFailed === 0) {
            console.log(colors.green('\n🎉 ALL TESTS PASSED!'));
            console.log(colors.green('✅ Voice calendar system is working correctly'));
        } else {
            console.log(colors.yellow(`\n⚠️  ${totalFailed} TESTS FAILED`));
            console.log(colors.yellow('❗ Please check the failed tests above'));
        }

        console.log(colors.blue('\n🏁 Testing complete'));
    }
}

// Run all tests if this file is executed directly
if (require.main === module) {
    const runner = new TestRunner();
    runner.runAllTestSuites().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error(colors.red('Test runner crashed:'), error);
        process.exit(1);
    });
}

module.exports = TestRunner;