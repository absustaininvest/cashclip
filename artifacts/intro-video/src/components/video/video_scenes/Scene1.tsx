import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),  // "REAL"
      setTimeout(() => setPhase(2), 800),  // "CASH."
      setTimeout(() => setPhase(3), 1600), // Subtext
      setTimeout(() => setPhase(4), 2800), // Exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.15, filter: 'blur(25px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Animated badge */}
        <motion.div 
          className="flex items-center gap-4 mb-6"
          initial={{ opacity: 0, scale: 0.8, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: -20 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="h-[2px] w-[6vw] bg-[#00f260]" />
          <p className="text-[1.5vw] text-[#00f260] font-bold tracking-[0.4em] uppercase shadow-sm">
            Stop Wasting Time
          </p>
          <div className="h-[2px] w-[6vw] bg-[#00f260]" />
        </motion.div>

        <div className="flex flex-col items-center leading-none">
          <div className="overflow-hidden">
            <motion.h1
              className="text-[14vw] font-black text-white tracking-tighter uppercase drop-shadow-2xl"
              initial={{ y: "100%", opacity: 0, rotateX: -30, scale: 0.9 }}
              animate={phase >= 1 ? { y: "0%", opacity: 1, rotateX: 0, scale: 1 } : { y: "100%", opacity: 0, rotateX: -30, scale: 0.9 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            >
              REAL
            </motion.h1>
          </div>
          <div className="overflow-hidden mt-[-3vw]">
            <motion.h1
              className="text-[14vw] font-black text-transparent bg-clip-text tracking-tighter uppercase pb-[1vw]"
              style={{ backgroundImage: 'linear-gradient(90deg, #00f260, #00b84c)', filter: 'drop-shadow(0 10px 20px rgba(0,242,96,0.3))' }}
              initial={{ y: "100%", opacity: 0, rotateX: -30, scale: 0.9 }}
              animate={phase >= 2 ? { y: "0%", opacity: 1, rotateX: 0, scale: 1 } : { y: "100%", opacity: 0, rotateX: -30, scale: 0.9 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            >
              CASH.
            </motion.h1>
          </div>
        </div>

        <motion.p
          className="mt-6 text-[2.5vw] text-slate-200 font-light tracking-widest uppercase"
          initial={{ opacity: 0, filter: 'blur(15px)', y: 20 }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)', y: 0 } : { opacity: 0, filter: 'blur(15px)', y: 20 }}
          transition={{ duration: 0.8 }}
        >
          Not points. <span className="font-bold text-white">Not gift cards.</span>
        </motion.p>
      </div>

      {/* Wipe element for transition out */}
      <motion.div 
        className="absolute inset-0 bg-[#0052ff] z-50 origin-bottom"
        initial={{ scaleY: 0 }}
        animate={phase >= 4 ? { scaleY: 1 } : { scaleY: 0 }}
        transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
      />
    </motion.div>
  );
}
