import React, { useEffect, useState, useRef } from 'react';
import api from '../api';
import socket from '../socket';
import CallUI from '../components/CallUI';

// const MEDIA_BASE_URL = 'http://localhost:5000'; // Change to your backend URL in production
const MEDIA_BASE_URL = `https://${import.meta.env.VITE_API_URL_MY_IP}:5000`; 

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: `turn:${import.meta.env.VITE_API_URL_MY_IP}:3478`,
      username: 'webrtc',
      credential: 'password123'
    }
  ]
};

const Chat = ({ user }) => {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const messagesEndRef = useRef(null);
  const [call, setCall] = useState(null); // { type, with: userId, isCaller }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const pcRef = useRef(null);
  const [incomingCall, setIncomingCall] = useState(null); // { from, type }
  const [error, setError] = useState('');

  // Fetch users
  const fetchUsers = () => {
    api.get('/users').then(res => setUsers(res.data));
  };
  useEffect(() => {
    fetchUsers();
  }, []);

  // Listen for users_updated event
  useEffect(() => {
    socket.on('users_updated', fetchUsers);
    return () => {
      socket.off('users_updated', fetchUsers);
    };
  }, []);

  // Fetch messages when user selected
  useEffect(() => {
    if (selectedUser) {
      api.get(`/messages/${selectedUser._id}`).then(res => setMessages(res.data));
      socket.emit('join', user.id);
    }
  }, [selectedUser, user.id]);

  // Real-time receive message
  useEffect(() => {
    socket.connect();
    socket.emit('join', user.id);
    socket.on('receive_message', (data) => {
      // data: { to, message, from }
      // Show message if it's from or to the selected user
      if (
        selectedUser &&
        (data.from === selectedUser._id || data.to === selectedUser._id)
      ) {
        setMessages((prev) => [...prev, data.message]);
      }
    });
    return () => {
      socket.off('receive_message');
      socket.disconnect();
    };
  }, [selectedUser, user.id]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message (text or media)
  const sendMessage = async (e) => {
    e.preventDefault();
    let mediaPath = '';
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      mediaPath = res.data.filePath;
    }
    const msg = {
      receiver: selectedUser._id,
      content: message,
      media: mediaPath,
      type: file ? (file.type.startsWith('image') ? 'image' : 'video') : 'text',
    };
    const res = await api.post('/messages', msg);
    setMessages((prev) => [...prev, res.data]);
    socket.emit('send_message', { to: selectedUser._id, message: res.data, from: user.id });
    setMessage('');
    setFile(null);
  };

  // Call handlers
  const startCall = async (type) => {
    if (!selectedUser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true,
      });
      setLocalStream(stream);
      setCall({ type, with: selectedUser._id, isCaller: true });
      pcRef.current = new RTCPeerConnection(iceServers);
      stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
      pcRef.current.ontrack = (e) => {
        setRemoteStream(prev => {
          const tracks = prev ? prev.getTracks() : [];
          // Avoid duplicates
          const newTracks = [...tracks];
          if (!newTracks.find(t => t.id === e.track.id)) {
            newTracks.push(e.track);
          }
          return new MediaStream(newTracks);
        });
      };
      pcRef.current.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('webrtc_ice_candidate', { roomId: user.id + '-' + selectedUser._id, candidate: e.candidate, from: user.id });
        }
      };
      socket.emit('join_call', user.id + '-' + selectedUser._id);
      socket.emit('join_call', selectedUser._id + '-' + user.id); // Ensure callee is in the room
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socket.emit('webrtc_offer', { roomId: user.id + '-' + selectedUser._id, offer, from: user.id });
    } catch (err) {
      if (type === 'video') {
        // Try audio-only fallback
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
          setCall({ type: 'audio', with: selectedUser._id, isCaller: true });
          pcRef.current = new RTCPeerConnection(iceServers);
          stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
          pcRef.current.ontrack = (e) => {
            if (e.track && e.track.kind === 'video') {
              setRemoteStream(new MediaStream([e.track]));
            } else if (e.streams && e.streams[0]) {
              setRemoteStream(e.streams[0]);
            }
          };
          pcRef.current.onicecandidate = (e) => {
            if (e.candidate) {
              socket.emit('webrtc_ice_candidate', { roomId: user.id + '-' + selectedUser._id, candidate: e.candidate, from: user.id });
            }
          };
          socket.emit('join_call', user.id + '-' + selectedUser._id);
          socket.emit('join_call', selectedUser._id + '-' + user.id);
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          socket.emit('webrtc_offer', { roomId: user.id + '-' + selectedUser._id, offer, from: user.id });
          setError('Camera not found. Switched to audio call.');
        } catch (audioErr) {
          setError('Could not access camera/microphone. Please check permissions and ensure no other app is using them.');
        }
      } else {
        setError('Could not access camera/microphone. Please check permissions and ensure no other app is using them.');
      }
    }
  };

  const handleReceiveOffer = async ({ offer, from }) => {
    if (!selectedUser || from !== selectedUser._id) {
      // Incoming call from another user
      setIncomingCall({ from, offer });
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: offer.sdp.includes('video'),
      audio: true,
    });
    setLocalStream(stream);
    setCall({ type: offer.sdp.includes('video') ? 'video' : 'audio', with: from, isCaller: false });
    pcRef.current = new RTCPeerConnection(iceServers);
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
    pcRef.current.ontrack = (e) => {
      setRemoteStream(prev => {
        const tracks = prev ? prev.getTracks() : [];
        // Avoid duplicates
        const newTracks = [...tracks];
        if (!newTracks.find(t => t.id === e.track.id)) {
          newTracks.push(e.track);
        }
        return new MediaStream(newTracks);
      });
    };
    pcRef.current.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice_candidate', { roomId: from + '-' + user.id, candidate: e.candidate, from: user.id });
      }
    };
    socket.emit('join_call', from + '-' + user.id);
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    socket.emit('webrtc_answer', { roomId: from + '-' + user.id, answer, from: user.id });
  };

  const handleReceiveAnswer = async ({ answer, from }) => {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async ({ candidate, from }) => {
    if (pcRef.current) {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  };

  useEffect(() => {
    socket.on('webrtc_offer', handleReceiveOffer);
    socket.on('webrtc_answer', handleReceiveAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);
    return () => {
      socket.off('webrtc_offer', handleReceiveOffer);
      socket.off('webrtc_answer', handleReceiveAnswer);
      socket.off('webrtc_ice_candidate', handleIceCandidate);
    };
  }, [selectedUser]);

  const endCall = () => {
    setCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const acceptCall = async () => {
    const { from, offer } = incomingCall;
    setIncomingCall(null);
    setSelectedUser(users.find(u => u._id === from));
    const stream = await navigator.mediaDevices.getUserMedia({
      video: offer.sdp.includes('video'),
      audio: true,
    });
    setLocalStream(stream);
    setCall({ type: offer.sdp.includes('video') ? 'video' : 'audio', with: from, isCaller: false });
    pcRef.current = new RTCPeerConnection(iceServers);
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
    pcRef.current.ontrack = (e) => {
      if (e.track && e.track.kind === 'video') {
        setRemoteStream(new MediaStream([e.track]));
      } else if (e.streams && e.streams[0]) {
        setRemoteStream(e.streams[0]);
      }
    };
    pcRef.current.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice_candidate', { roomId: from + '-' + user.id, candidate: e.candidate, from: user.id });
      }
    };
    socket.emit('join_call', from + '-' + user.id);
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    socket.emit('webrtc_answer', { roomId: from + '-' + user.id, answer, from: user.id });
  };

  const declineCall = () => {
    setIncomingCall(null);
    setError('Call declined.');
  };

  // Helper function to trigger download
  const handleDownload = async (url, filename) => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert('Download failed');
    }
  };

  return (
    <div className="chat-container" style={{ display: 'flex', height: '90vh' }}>
      <div className="user-list" style={{ width: 200, borderRight: '1px solid #ccc', overflowY: 'auto' }}>
        <h3>Users</h3>
        {users.map(u => (
          <div
            key={u._id}
            style={{ padding: 8, cursor: 'pointer', background: selectedUser?._id === u._id ? '#eee' : '' }}
            onClick={() => setSelectedUser(u)}
          >
            {u.username}
          </div>
        ))}
      </div>
      <div className="chat-window" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="messages" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 10, textAlign: msg.sender === user.id ? 'right' : 'left' }}>
              {msg.type === 'text' && <span>{msg.content}</span>}
              {msg.type === 'image' && (
                <>
                  <img src={MEDIA_BASE_URL + msg.media} alt="img" style={{ maxWidth: 200 }} />
                  <a
                    href={MEDIA_BASE_URL + msg.media}
                    download
                    style={{ display: 'block', color: '#075e54', marginTop: 4 }}
                  >
                    Download Image
                  </a>
                </>
              )}
              {msg.type === 'video' && (
                <>
                  <video src={MEDIA_BASE_URL + msg.media} controls style={{ maxWidth: 200 }} />
                  <a
                    href={MEDIA_BASE_URL + msg.media}
                    download
                    style={{ display: 'block', color: '#075e54', marginTop: 4 }}
                  >
                    Download Video
                  </a>
                </>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {selectedUser && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={() => startCall('audio')}>Audio Call</button>
            <button onClick={() => startCall('video')}>Video Call</button>
          </div>
        )}
        {call && (
          <CallUI
            isCaller={call.isCaller}
            callType={call.type}
            onEnd={endCall}
            localStream={localStream}
            remoteStream={remoteStream}
            pcRef={pcRef}
          />
        )}
        {selectedUser && (
          <form onSubmit={sendMessage} style={{ display: 'flex', padding: 8, borderTop: '1px solid #ccc' }}>
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type a message"
              style={{ flex: 1, marginRight: 8 }}
              required={!file}
            />
            <input type="file" accept="image/*,video/*" onChange={e => setFile(e.target.files[0])} />
            <button type="submit">Send</button>
          </form>
        )}
      </div>
      {incomingCall && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.3)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 2px 16px rgba(0,0,0,0.12)', textAlign: 'center' }}>
            <h3>Incoming {incomingCall.offer.sdp.includes('video') ? 'Video' : 'Audio'} Call</h3>
            <button onClick={acceptCall} style={{ background: '#25d366', color: '#fff', marginRight: 16, border: 'none', borderRadius: 6, padding: '10px 18px', fontWeight: 500 }}>Accept</button>
            <button onClick={declineCall} style={{ background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', fontWeight: 500 }}>Decline</button>
          </div>
        </div>
      )}
      {error && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#d32f2f', color: '#fff', padding: '10px 24px', borderRadius: 8, zIndex: 3000 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 16, background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer' }}>x</button>
        </div>
      )}
    </div>
  );
};

export default Chat; 