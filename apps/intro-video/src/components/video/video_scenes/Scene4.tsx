import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),  // Icon/circle
      setTimeout(() => setPhase(2), 800),  // "No Limits"
      setTimeout(() => setPhase(3), 1400), // "No BS"
      setTimeout(() => setPhase(4), 2800), // Exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-20"
      initial={{ opacity: 0, scale: 1.2 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5, filter: 'blur(30px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      style={{ perspective: 1500 }}
    >
      {/* Radial wipe in */}
      <motion.div 
        className="absolute inset-0 bg-[#00f260] z-0"
        initial={{ clipPath: 'circle(100% at 50% 50%)' }}
        animate={{ clipPath: 'circle(0% at 50% 50%)' }}
        transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
      />

      <div className="flex flex-col items-center justify-center z-30 w-full relative">
        <motion.div
          className="w-[18vw] h-[18vw] rounded-full border-[1.5vw] border-white/5 flex items-center justify-center mb-[4vh] relative"
          initial={{ rotate: -180, opacity: 0, scale: 0.5 }}
          animate={phase >= 1 ? { rotate: 0, opacity: 1, scale: 1 } : { rotate: -180, opacity: 0, scale: 0.5 }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        >
          <motion.div 
            className="absolute inset-0 rounded-full border-[1.5vw] border-[#00f260]"
            style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
          <svg width="8vw" height="8vw" viewBox="0 0 24 24" fill="none" stroke="#00f260" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </motion.div>

        <div className="overflow-hidden">
          <motion.h2 
            className="text-[12vw] font-black text-white tracking-tighter uppercase leading-[0.9] drop-shadow-2xl text-center"
            initial={{ opacity: 0, y: "100%", rotateX: -45 }}
            animate={phase >= 2 ? { opacity: 1, y: "0%", rotateX: 0 } : { opacity: 0, y: "100%", rotateX: -45 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            NO LIMITS.
          </motion.h2>
        </div>
        
        <div className="overflow-hidden mt-[-1vw]">
          <motion.h2 
            className="text-[12vw] font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-400 to-white tracking-tighter uppercase leading-[1.1] drop-shadow-lg text-center"
            initial={{ opacity: 0, y: "100%", rotateX: -45 }}
            animate={phase >= 3 ? { opacity: 1, y: "0%", rotateX: 0 } : { opacity: 0, y: "100%", rotateX: -45 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            NO BS.
          </motion.h2>
        </div>
      </div>
    </motion.div>
  );
}
