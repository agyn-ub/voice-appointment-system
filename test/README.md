# Voice Calendar Testing Suite

Automated testing for the voice calendar Firebase functions and Google Calendar integration.

## Setup

1. **Prerequisites**:
   - Firebase service account key at `../service_account.json`
   - Test user with Google Calendar connected
   - Update `TEST_USER_ID` in `test-setup.js`

2. **Install dependencies**:
   ```bash
   npm install
   ```

## Running Tests

### All Tests
```bash
npm run test
```

### Individual Test Suites
```bash
npm run test:voice     # Voice command tests
npm run test:calendar  # Calendar sync tests (future)
npm run test:data      # Data validation tests (future)
```

## Test Coverage

### Voice Command Tests
- ✅ Schedule appointments ("Schedule meeting with John tomorrow at 2pm")
- ✅ Create personal events ("Remind me to go to gym Friday at 6pm")  
- ✅ Retrieve appointments ("What meetings do I have today?")
- ✅ Cancel appointments ("Cancel my meeting with Sarah tomorrow")
- ✅ Error handling (invalid/ambiguous commands)
- ✅ Google Calendar integration verification

### What Gets Tested
1. **Firebase Functions**: Calls `processVoiceCommand` with various inputs
2. **OpenAI Integration**: Verifies AI processes commands correctly  
3. **Firestore Operations**: Checks appointments are saved/updated/deleted
4. **Google Calendar Sync**: Validates calendar integration works
5. **Error Handling**: Tests graceful failure scenarios

## Test Results

Tests provide detailed output including:
- ✅/❌ Pass/fail status for each test
- 📊 Execution time for each test
- 📋 Detailed error messages for failures
- 🎉 Overall summary and statistics

## Troubleshooting

### Common Issues

**Firebase Authentication Errors**:
- Check service account key path
- Verify test user ID is correct

**Google Calendar Token Errors**:
- Ensure test user has connected Google Calendar in the app
- Check tokens exist in Firestore

**Function Call Failures**:
- Verify Firebase functions are deployed
- Check OpenAI API key is configured as secret

### Debug Tips

1. **Check Firestore directly**:
   ```javascript
   const appointments = await testSetup.getAppointments();
   console.log(appointments);
   ```

2. **Verify Google tokens**:
   ```javascript
   const tokens = await testSetup.getGoogleTokens();
   console.log(tokens);
   ```

3. **Test function calls manually**:
   ```javascript
   const result = await testSetup.callFunction('processVoiceCommand', {
     command: 'test command',
     timezone: 'America/Los_Angeles'
   });
   ```

## Files

- `test-setup.js` - Firebase initialization and utilities
- `test-voice-commands.js` - Voice command test scenarios
- `run-tests.js` - Test runner and reporting
- `package.json` - Dependencies and scripts

## Integration Testing

This testing suite validates the complete flow:
```
Voice Command → OpenAI Assistant → Firebase Function → Firestore → Google Calendar
```

All tests use real integrations (no mocks) to ensure end-to-end functionality works correctly.