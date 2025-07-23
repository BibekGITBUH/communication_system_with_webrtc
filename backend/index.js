const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.send('Backend API is running');
});

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

const messagesRoutes = require('./routes/messages');
app.use('/api/messages', messagesRoutes);

const mediaRoutes = require('./routes/media');
app.use('/api/media', mediaRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_clone', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch((err) => console.error('MongoDB connection error:', err));

const key = fs.readFileSync('../frontend/certs/localhost-key.pem');
const cert = fs.readFileSync('../frontend/certs/localhost.pem');

const server = https.createServer({ key, cert }, app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const chatHandler = require('./socketHandlers/chat');
const webrtcHandler = require('./socketHandlers/webrtc');

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  chatHandler(io, socket);
  webrtcHandler(io, socket);
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Replace app.listen with server.listen
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTPS Server running on port ${PORT}`);
}); 