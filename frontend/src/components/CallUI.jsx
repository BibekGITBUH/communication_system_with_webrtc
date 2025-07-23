import React, { useRef, useEffect, useState } from 'react';

const CallUI = ({ isCaller, callType, onEnd, localStream, remoteStream, pcRef }) => {
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const [muted, setMuted] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const originalVideoTrackRef = useRef(null);
  const [remoteVolume, setRemoteVolume] = useState(0);
  const [screenSender, setScreenSender] = useState(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Sync muted state with audio track
  useEffect(() => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        setMuted(!audioTracks[0].enabled);
      }
    }
  }, [localStream]);

  // Volume detection for remote audio
  useEffect(() => {
    let audioContext, analyser, source, dataArray, rafId;
    if (remoteStream && remoteStream.getAudioTracks().length > 0) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      source = audioContext.createMediaStreamSource(remoteStream);
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.fftSize);
      const checkVolume = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setRemoteVolume(rms);
        rafId = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    }
    return () => {
      if (audioContext) audioContext.close();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [remoteStream]);

  const handleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const currentlyEnabled = audioTracks[0].enabled;
        audioTracks.forEach(track => {
          track.enabled = !currentlyEnabled;
        });
        setMuted(current => !current);
      }
    }
  };

  // Screen sharing logic
  const handleShareScreen = async () => {
    if (!localStream || !pcRef || !pcRef.current) return;
    if (!isSharingScreen) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (!originalVideoTrackRef.current) {
          const camTrack = localStream.getVideoTracks()[0];
          originalVideoTrackRef.current = camTrack;
        }
        // Always get the sender from the current peer connection
        const sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
          setScreenSender(sender);
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        setIsSharingScreen(true);
        screenTrack.onended = async () => {
          if (originalVideoTrackRef.current && sender) {
            await sender.replaceTrack(originalVideoTrackRef.current);
            if (localVideoRef.current && localStream) {
              localVideoRef.current.srcObject = localStream;
            }
            setIsSharingScreen(false);
          }
        };
      } catch (err) {
        alert('Screen sharing failed or was cancelled.');
      }
    } else {
      // Stop sharing: restore camera
      if (originalVideoTrackRef.current && screenSender) {
        await screenSender.replaceTrack(originalVideoTrackRef.current);
        if (localVideoRef.current && localStream) {
          localVideoRef.current.srcObject = localStream;
        }
        setIsSharingScreen(false);
      }
    }
  };

  // Map volume to border color (gray for silence, green/yellow/red for sound)
  const getBorderColor = (vol) => {
    if (vol < 0.01) return '#bbb'; // silent (gray)
    if (vol > 0.15) return '#d32f2f'; // loud
    if (vol > 0.05) return '#fbc02d'; // medium
    return '#25d366'; // quiet (green)
  };

  return (
    <div className="call-ui" style={{ position: 'fixed', top: 20, right: 20, background: '#fff', border: '1px solid #ccc', zIndex: 1000, padding: 16 }}>
      <h3>{callType === 'video' ? 'Video Call' : 'Audio Call'}</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <video ref={localVideoRef} autoPlay muted playsInline style={{ width: 120, height: 90, background: '#000' }} />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{
            width: 240,
            height: 180,
            background: '#000',
            border: `4px solid ${getBorderColor(remoteVolume)}`,
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
        />
      </div>
      <button onClick={handleMute} style={{ marginTop: 8, background: muted ? '#888' : '#25d366', color: '#fff', marginRight: 8 }}>
        {muted ? 'Unmute' : 'Mute'}
      </button>
      <button onClick={handleShareScreen} style={{ marginTop: 8, background: isSharingScreen ? '#888' : '#007bff', color: '#fff', marginRight: 8 }}>
        {isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
      </button>
      <button onClick={onEnd} style={{ marginTop: 8, background: 'red', color: '#fff' }}>End Call</button>
    </div>
  );
};

export default CallUI; 