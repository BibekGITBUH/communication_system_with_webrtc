module.exports = (io, socket) => {
  // Join a user-specific room
  socket.on('join', (userId) => {
    socket.join(userId);
  });

  // Handle sending a message
  socket.on('send_message', (data) => {
    // data: { to, message }
    io.to(data.to).emit('receive_message', data);
  });

  // Listen for user registration and broadcast update
  socket.on('user_registered', () => {
    io.emit('users_updated');
  });
}; 