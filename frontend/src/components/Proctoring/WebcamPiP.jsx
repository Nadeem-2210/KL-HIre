import React, { useState, useEffect, useRef } from 'react';

const WebcamPiP = ({ videoRef, faceViolationCount }) => {
  const [position, setPosition] = useState({ right: 20, bottom: 20 });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startRight: 20, startBottom: 20 });

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only left click
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom,
    };
    e.preventDefault(); // Prevents text selection during drag
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragRef.current.isDragging) return;
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;
      
      let nextRight = dragRef.current.startRight - deltaX;
      let nextBottom = dragRef.current.startBottom - deltaY;

      // Constrain boundaries to prevent dragging offscreen
      const maxRight = window.innerWidth - 180; // 160 width + margin
      const maxBottom = window.innerHeight - 140; // 120 height + margin
      
      nextRight = Math.max(10, Math.min(maxRight, nextRight));
      nextBottom = Math.max(10, Math.min(maxBottom, nextBottom));

      setPosition({ right: nextRight, bottom: nextBottom });
    };

    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div 
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        bottom: position.bottom,
        right: position.right,
        zIndex: 9000,
        width: 160,
        height: 120,
        borderRadius: 12,
        overflow: 'hidden',
        border: `2px solid ${faceViolationCount > 0 ? '#ef4444' : '#10b981'}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        background: '#000',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
          pointerEvents: 'none' // Prevents browser focus or actions on the video element itself
        }}
      />
      {/* Monitoring indicator */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 6,
        background: faceViolationCount > 0 ? '#ef4444' : '#10b981',
        borderRadius: 20,
        padding: '2px 8px',
        fontSize: '0.6rem',
        fontWeight: 700,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#fff',
          display: 'inline-block',
          animation: 'pulse-dot 1.5s infinite'
        }} />
        LIVE
      </div>
    </div>
  );
};

export default WebcamPiP;
