# 🔐 Firebase Authentication Setup Guide

This guide walks you through setting up Firebase Authentication for the Voice Appointment System.

## 📋 Prerequisites

- Firebase project created (already done ✅)
- Firebase CLI installed
- iOS/Android app project

## 🚀 Step-by-Step Setup

### 1. **Enable Firebase Authentication**

1. **Go to Firebase Console:**
   - Visit: https://console.firebase.google.com/
   - Select your project: `learning-auth-e6ea2`

2. **Enable Authentication:**
   ```
   Navigation: Build > Authentication
   Click: Get started
   ```

3. **Configure Sign-in Methods:**
   ```
   Go to: Sign-in method tab
   Enable desired providers:
   - Email/Password (recommended for testing)
   - Google (optional, for Google Sign-In)
   - Anonymous (optional, for guest users)
   ```

### 2. **Update Firestore Security Rules**

Replace your current `firestore.rules` with authenticated access:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow users to access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Allow authenticated users to access their artifacts
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 3. **iOS Integration**

#### Add Firebase Auth to your iOS project:

1. **Install Firebase Auth:**
   ```swift
   // In Package.swift or via SPM
   dependencies: [
       .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "10.0.0")
   ]
   
   // In your target
   .product(name: "FirebaseAuth", package: "firebase-ios-sdk")
   ```

2. **Initialize Firebase:**
   ```swift
   import SwiftUI
   import FirebaseCore
   import FirebaseAuth

   @main
   struct VoiceAppointmentApp: App {
       init() {
           FirebaseApp.configure()
       }
       
       var body: some Scene {
           WindowGroup {
               ContentView()
           }
       }
   }
   ```

#### Authentication Flow:

```swift
import FirebaseAuth

class AuthManager: ObservableObject {
    @Published var user: User?
    @Published var isSignedIn = false
    
    init() {
        listenToAuthState()
    }
    
    func listenToAuthState() {
        Auth.auth().addStateDidChangeListener { [weak self] _, user in
            DispatchQueue.main.async {
                self?.user = user
                self?.isSignedIn = user != nil
            }
        }
    }
    
    func signUp(email: String, password: String) async throws {
        let result = try await Auth.auth().createUser(withEmail: email, password: password)
        print("User created: \(result.user.uid)")
    }
    
    func signIn(email: String, password: String) async throws {
        let result = try await Auth.auth().signIn(withEmail: email, password: password)
        print("User signed in: \(result.user.uid)")
    }
    
    func signOut() throws {
        try Auth.auth().signOut()
        print("User signed out")
    }
    
    // Get current user UID for voice commands
    func getCurrentUserUID() -> String? {
        return Auth.auth().currentUser?.uid
    }
}
```

#### Voice Command Integration:

```swift
import FirebaseAuth
import FirebaseFunctions

class VoiceCommandManager {
    private let functions = Functions.functions()
    
    func processVoiceCommand(_ command: String) async throws -> [String: Any] {
        // Ensure user is authenticated
        guard let currentUser = Auth.auth().currentUser else {
            throw NSError(domain: "AuthError", code: 0, userInfo: [NSLocalizedDescriptionKey: "User must be signed in"])
        }
        
        // Get ID token for authentication
        let idToken = try await currentUser.getIDToken()
        
        // Call the Firebase Function
        let callable = functions.httpsCallable("processVoiceCommand")
        let result = try await callable.call([
            "command": command
        ])
        
        return result.data as? [String: Any] ?? [:]
    }
    
    func startGoogleCalendarAuth() {
        guard let currentUser = Auth.auth().currentUser else {
            print("User must be signed in first")
            return
        }
        
        // Use the OAuth flow with real user UID
        let state = currentUser.uid
        // ... rest of OAuth code from GOOGLE_OAUTH_SETUP.md
    }
}
```

#### UI Example:

```swift
import SwiftUI
import FirebaseAuth

struct ContentView: View {
    @StateObject private var authManager = AuthManager()
    @StateObject private var voiceManager = VoiceCommandManager()
    @State private var email = ""
    @State private var password = ""
    
    var body: some View {
        NavigationView {
            if authManager.isSignedIn {
                VoiceAppView()
                    .environmentObject(authManager)
                    .environmentObject(voiceManager)
            } else {
                SignInView(authManager: authManager, email: $email, password: $password)
            }
        }
    }
}

struct SignInView: View {
    let authManager: AuthManager
    @Binding var email: String
    @Binding var password: String
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Voice Appointment System")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            TextField("Email", text: $email)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .autocapitalization(.none)
            
            SecureField("Password", text: $password)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            
            Button("Sign In") {
                Task {
                    try? await authManager.signIn(email: email, password: password)
                }
            }
            .buttonStyle(.borderedProminent)
            
            Button("Sign Up") {
                Task {
                    try? await authManager.signUp(email: email, password: password)
                }
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }
}
```

### 4. **Testing Authentication**

1. **Create Test User:**
   ```
   Go to Firebase Console > Authentication > Users
   Click: Add user
   Email: test@example.com
   Password: testpassword123
   ```

2. **Test Voice Commands:**
   ```swift
   // After user signs in
   let command = "Schedule a meeting with John tomorrow at 2 PM"
   let result = try await voiceManager.processVoiceCommand(command)
   print("Result: \(result)")
   ```

3. **Verify Firestore Data:**
   ```
   Check: /users/{REAL_USER_UID}/appointments
   Should contain appointments for authenticated user only
   ```

## 🔒 Security Benefits

- ✅ **User Isolation:** Each user can only access their own data
- ✅ **Secure Tokens:** Firebase handles token validation automatically
- ✅ **OAuth Integration:** Google Calendar tokens tied to specific users
- ✅ **Data Protection:** Firestore rules prevent unauthorized access

## 🐛 Troubleshooting

### Common Issues:

1. **"User must be authenticated"**
   - Ensure user is signed in before calling voice commands
   - Check Firebase Auth configuration

2. **"Permission denied" in Firestore**
   - Verify Firestore rules are updated
   - Confirm user UID matches rule requirements

3. **Google Calendar not connecting**
   - User must be Firebase authenticated first
   - Use real Firebase UID in OAuth state parameter

### Debug Steps:

1. **Check Auth State:**
   ```swift
   if let user = Auth.auth().currentUser {
       print("User signed in: \(user.uid)")
   } else {
       print("No user signed in")
   }
   ```

2. **Test Function Calls:**
   ```bash
   firebase functions:log --only processVoiceCommand
   ```

3. **Verify Firestore Rules:**
   ```bash
   firebase firestore:rules:get
   ```

## ✅ Success Indicators

- ✅ Firebase Auth enabled and configured
- ✅ Sign-in methods working (Email/Password)
- ✅ Users can create accounts and sign in
- ✅ Voice commands work only when authenticated
- ✅ Firestore data isolated by user
- ✅ Google Calendar OAuth uses real user UIDs

---

**Your voice appointment system now has secure user authentication! 🔐** 