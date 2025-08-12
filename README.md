# 🎤 Voice-Controlled Appointment Management System

A smart, AI-powered appointment management system built with Firebase Functions and OpenAI GPT-4o-mini. This system allows users to schedule, cancel, retrieve, and manage appointments using natural language voice commands.

## ✨ Features

- **🎤 Voice Command Processing**: Natural language understanding for appointment management
- **🤖 AI-Powered**: Uses OpenAI GPT-4o-mini for intent detection and entity extraction
- **📅 Smart Scheduling**: Schedule appointments with automatic title generation
- **❌ Flexible Cancellation**: Cancel appointments by title, attendees, or time
- **📋 Appointment Retrieval**: Get appointments for specific date ranges
- **👥 Attendee Management**: Support for multiple attendees per appointment
- **🛡️ Error Handling**: Robust error handling with graceful fallbacks
- **🔍 Fuzzy Matching**: Smart matching for appointment cancellation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Firebase CLI
- OpenAI API key
- Firebase project (Blaze plan required for external API calls)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd voice-appointment-system
   ```

2. **Install dependencies**
   ```bash
   cd functions
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # In functions/.env
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Initialize Firebase**
   ```bash
   firebase init
   # Select: Functions, Firestore, Hosting (optional)
   ```

5. **Deploy to Firebase**
   ```bash
   firebase deploy --only functions
   ```

## 📱 API Usage

### Endpoint
```
POST https://us-central1-your-project.cloudfunctions.net/processVoiceCommand
```

### Request Format
```json
{
  "data": {
    "command": "Schedule a meeting with John tomorrow at 2 PM for 30 minutes"
  }
}
```

### Response Format
```json
{
  "result": {
    "success": true,
    "message": "I've scheduled a meeting with John tomorrow at 2 PM for 30 minutes.",
    "intent": "schedule_appointment",
    "details": {
      "title": "Meeting with John",
      "date": "2025-07-26",
      "time": "14:00",
      "duration": 30,
      "attendees": ["John"]
    }
  }
}
```

## 🎯 Supported Voice Commands

### 📅 Scheduling Appointments
- "Schedule a meeting with John tomorrow at 2 PM for 30 minutes"
- "Make an appointment for tomorrow with John for 5 PM"
- "Book a meeting with Sarah next Friday at 3 PM"
- "Create an appointment with Alice tomorrow at 10 AM"

### ❌ Cancelling Appointments
- "Cancel my meeting with John tomorrow"
- "Delete appointment with Sara for tomorrow 1 PM"
- "Remove the project review meeting on July 20th"
- "Cancel appointment with John for tomorrow 1 PM"

### 📋 Retrieving Appointments
- "Show me my appointments for tomorrow"
- "What appointments do I have this week?"
- "List my meetings from July 25th to July 30th"

### ⏰ Setting Availability
- "Set my availability to Monday to Friday from 9 AM to 5 PM"
- "I'm free on Tuesdays from 10 to 4"

## 🏗️ Architecture

### Firebase Functions
- **`processVoiceCommand`**: Main callable function that processes voice commands
- **Intent Detection**: Uses OpenAI GPT-4o-mini to understand user intent
- **Entity Extraction**: Extracts appointment details from natural language

### Firestore Database
- **Collections**: `users/{userId}/appointments`, `users/{userId}/availability`
- **Indexes**: Composite index on `(date, time)` for efficient queries

### AI Integration
- **Model**: OpenAI GPT-4o-mini
- **Purpose**: Intent classification and entity extraction
- **Output**: Structured JSON with intent and details

## 🔧 Configuration

### Environment Variables
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### Firebase Configuration
```json
{
  "functions": {
    "source": "functions"
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

## 🧪 Testing

### Local Testing
```bash
# Start Firebase emulator
firebase emulators:start --only functions

# Test with curl
curl -X POST http://localhost:5001/your-project/us-central1/processVoiceCommand \
  -H "Content-Type: application/json" \
  -d '{"data": {"command": "Schedule a meeting with John tomorrow at 2 PM"}}'
```

### Production Testing
```bash
# Test deployed function
curl -X POST https://us-central1-your-project.cloudfunctions.net/processVoiceCommand \
  -H "Content-Type: application/json" \
  -d '{"data": {"command": "Show me my appointments for tomorrow"}}'
```

## 🛠️ Development

### Project Structure
```
├── functions/
│   ├── src/
│   │   └── index.ts          # Main function logic
│   ├── package.json
│   └── tsconfig.json
├── firestore.rules           # Firestore security rules
├── firestore.indexes.json    # Firestore indexes
├── firebase.json            # Firebase configuration
└── README.md
```

### Key Functions
- **`calculateSimilarity()`**: Levenshtein distance for fuzzy matching
- **`levenshteinDistance()`**: String similarity calculation
- **`processVoiceCommand()`**: Main voice command processor

## 🔒 Security

### Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Authentication
- Currently uses placeholder user ID for testing
- Production should implement proper Firebase Authentication
- User ID validation in Firestore rules

## 🚨 Error Handling

### Common Error Scenarios
- **Missing API Key**: OpenAI API key not configured
- **Invalid Command**: Unrecognized voice command
- **Missing Details**: Incomplete appointment information
- **Database Errors**: Firestore operation failures

### Error Response Format
```json
{
  "error": {
    "message": "Missing or invalid details for scheduling an appointment.",
    "status": "INVALID_ARGUMENT"
  }
}
```

## 📈 Performance

### Optimizations
- **Caching**: OpenAI responses cached where appropriate
- **Indexing**: Firestore composite indexes for efficient queries
- **Batch Operations**: Batch writes for multiple operations
- **Error Recovery**: Graceful handling of API failures

### Monitoring
- Firebase Functions logs
- OpenAI API usage monitoring
- Firestore query performance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for GPT-4o-mini API
- Firebase for serverless infrastructure
- TypeScript for type safety
- The open-source community for inspiration

## 📞 Support

For support and questions:
- Create an issue in this repository
- Check Firebase documentation
- Review OpenAI API documentation

---

**Built with ❤️ using Firebase Functions and OpenAI** 

