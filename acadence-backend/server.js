import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import userRoutes from "./routes/users.js";
import courseRoutes from "./routes/courses.js";
import lessonRoutes from "./routes/lessons.js";
import quizRoutes from "./routes/quizzes.js";
import generateCourseRoutes from "./routes/generateCourse.js";
import contactRoutes from "./routes/contact.js";
import exportRoutes from "./routes/export.js";
import { getChatbotModel } from "./config/gemini.js";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

const DEFAULT_PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/acadence";

// ✅ Connect to MongoDB with retry options
mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    console.error("\n🔍 Troubleshooting:");
    console.error("1. Check if your IP is whitelisted in MongoDB Atlas");
    console.error("2. Verify your connection string in .env file");
    console.error("3. Wait 2-3 minutes after adding IP to whitelist");
    process.exit(1);
  });

// ✅ Chatbot endpoint with context awareness
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId, userName, userEmail, courses, conversationHistory } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    console.log("📩 Chat request received:", { message, userId, coursesCount: courses?.length || 0 });

    // Build context prompt
    let contextPrompt = `You are Acadence AI, a friendly and knowledgeable learning assistant for an educational platform called Acadence. 

Your role is to:
- Help students find and understand courses
- Answer questions about learning paths and skills
- Provide study tips and motivation
- Explain concepts in simple terms
- Recommend courses based on interests
- Help with course navigation and features
- Answer questions about their enrolled courses and progress

Guidelines:
- Be friendly, encouraging, and supportive
- Keep responses concise but helpful (2-4 sentences max unless explaining something complex)
- Use simple, clear language
- If asked about specific courses they haven't enrolled in, suggest they explore the course catalog
- For technical questions, provide clear step-by-step explanations
- Always be positive and motivating
- Reference their actual enrolled courses when relevant
- Celebrate their progress and achievements

`;

    // Add user-specific context
    if (userName) {
      contextPrompt += `\nUser Information:
- Name: ${userName}
${userEmail ? `- Email: ${userEmail}` : ''}
- Total Enrolled Courses: ${courses?.length || 0}
`;

      // Add course information
      if (courses && courses.length > 0) {
        contextPrompt += `\nUser's Enrolled Courses:\n`;
        courses.forEach((course) => {
          contextPrompt += `- "${course.title}"
  • Topic: ${course.topic}
  • Difficulty: ${course.difficulty}
  • Progress: ${course.progress} (${course.completionPercentage}% complete)
  • Duration: ${course.estimatedDuration || 'Not specified'}
`;
        });
      } else {
        contextPrompt += `\nNote: User hasn't enrolled in any courses yet. Encourage them to explore the course catalog and recommend starting with beginner-friendly topics.`;
      }
    }

    // Add conversation history for context continuity
    if (conversationHistory && conversationHistory.length > 0) {
      contextPrompt += `\n\nRecent Conversation:\n`;
      conversationHistory.forEach(msg => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}\n`;
      });
    }

    contextPrompt += `\nUser's Current Question: ${message}\n\nProvide a helpful, personalized response:`;

    console.log("🤖 Calling Gemini API...");
    const model = getChatbotModel();
    const result = await model.generateContent(contextPrompt);
    const reply = result.response.text();

    console.log("✅ Gemini response received");
    res.json({ reply });
  } catch (error) {
    console.error("❌ Gemini API error:", error);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// ✅ Request logger middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  next();
});

// ✅ API Routes
app.use("/api/users", userRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/generate-course", generateCourseRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/export", exportRoutes);

// ✅ AI-Powered Recommendations endpoint
app.get("/api/recommendations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    console.log("🎯 Generating AI recommendations for user:", userId);

    // Import models
    const User = (await import("./models/User.js")).default;
    const Course = (await import("./models/Course.js")).default;

    // Fetch user and their courses
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userCourses = await Course.find({ userId });

    // Prepare data for AI
    let coursesData = "";
    if (userCourses.length > 0) {
      coursesData = userCourses.map((course, index) => {
        const completionRate = course.totalLessons > 0 
          ? Math.round((course.completedLessons / course.totalLessons) * 100)
          : 0;
        
        return `${index + 1}. "${course.title}"
   - Topic: ${course.topic}
   - Difficulty: ${course.difficulty}
   - Progress: ${completionRate}% (${course.completedLessons}/${course.totalLessons} lessons)
   - Status: ${completionRate === 100 ? 'Completed ✓' : completionRate > 0 ? 'In Progress' : 'Not Started'}`;
      }).join('\n\n');
    }

    // Build AI prompt for recommendations
    const prompt = `You are an expert educational advisor for Acadence, an online learning platform.

User Profile:
- Name: ${user.name}
- Email: ${user.email}
- Total Enrolled Courses: ${userCourses.length}

${userCourses.length > 0 ? `Current Courses:\n${coursesData}` : 'No courses enrolled yet.'}

Based on the user's learning journey, recommend 3 relevant courses they should take next. 

${userCourses.length > 0 
  ? `Consider:
- Topics they've shown interest in
- Natural progression from completed courses
- Complementary skills to what they're learning
- Difficulty progression (don't jump too high)
- Fill knowledge gaps in their learning path`
  : `Since they're a new learner, recommend:
- Popular beginner-friendly courses
- Foundational topics in different areas
- Courses that build transferable skills`
}

Return ONLY a valid JSON array with exactly 3 course recommendations in this format:
[
  {
    "title": "Course Name",
    "topic": "Main Topic",
    "difficulty": "beginner/intermediate/advanced",
    "description": "2-3 sentence description of what they'll learn and why it's recommended for them",
    "estimatedDuration": "X weeks",
    "reason": "1 sentence explaining why this is recommended based on their current progress"
  }
]

Important: Return ONLY the JSON array, no other text or explanation.`;

    console.log("🤖 Calling Gemini for recommendations...");
    
    // Call Gemini API
    const model = getCourseGenerationModel(); // Using course generation model for JSON response
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    console.log("📝 Raw AI response:", responseText);

    // Parse JSON response
    let recommendations;
    try {
      // Clean the response (remove markdown code blocks if present)
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      recommendations = JSON.parse(cleanedResponse);
      
      // Validate structure
      if (!Array.isArray(recommendations) || recommendations.length === 0) {
        throw new Error("Invalid recommendations format");
      }

      console.log("✅ Generated", recommendations.length, "recommendations");
      res.json(recommendations);

    } catch (parseError) {
      console.error("❌ Failed to parse AI response:", parseError);
      // Fallback recommendations
      res.json([
        {
          title: "Introduction to Programming",
          topic: "Computer Science",
          difficulty: "beginner",
          description: "Start your coding journey with fundamental programming concepts, logic, and problem-solving skills.",
          estimatedDuration: "4 weeks",
          reason: "Perfect starting point for new learners"
        },
        {
          title: "Web Development Fundamentals",
          topic: "Web Development",
          difficulty: "beginner",
          description: "Learn HTML, CSS, and JavaScript basics to build your first websites and web applications.",
          estimatedDuration: "6 weeks",
          reason: "High-demand skill with immediate practical applications"
        },
        {
          title: "Data Science Basics",
          topic: "Data Science",
          difficulty: "beginner",
          description: "Explore data analysis, visualization, and statistical thinking to make data-driven decisions.",
          estimatedDuration: "5 weeks",
          reason: "Growing field with opportunities across all industries"
        }
      ]);
    }

  } catch (error) {
    console.error("❌ Recommendations error:", error);
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

// ✅ Test Gemini endpoint
app.get("/api/test-gemini", async (req, res) => {
  try {
    console.log("🧪 Testing Gemini API...");
    const model = getChatbotModel();
    const result = await model.generateContent("Say hello in 3 words");
    const reply = result.response.text();
    console.log("✅ Gemini test successful:", reply);
    res.json({ success: true, response: reply });
  } catch (error) {
    console.error("❌ Gemini test failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ✅ Start server
app.listen(DEFAULT_PORT, () => {
  console.log(`✅ Server running on port ${DEFAULT_PORT}`);
});
