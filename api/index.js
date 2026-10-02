// Vercel serverless entry: wraps the Express app from server.js.
// server.js detects process.env.VERCEL, skips app.listen() and exports the app.
export { default } from '../server.js';
