module.exports = (io, socket) => {
  // Join a call room
  socket.on('join_call', (roomId) => {
    socket.join(roomId);
  });

  // Relay offer
  socket.on('webrtc_offer', ({ roomId, offer, from }) => {
    socket.to(roomId).emit('webrtc_offer', { offer, from });
  });

  // Relay answer
  socket.on('webrtc_answer', ({ roomId, answer, from }) => {
    socket.to(roomId).emit('webrtc_answer', { answer, from });
  });

  // Relay ICE candidates
  socket.on('webrtc_ice_candidate', ({ roomId, candidate, from }) => {
    socket.to(roomId).emit('webrtc_ice_candidate', { candidate, from });
  });
}; 