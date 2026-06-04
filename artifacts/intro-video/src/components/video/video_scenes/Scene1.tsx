import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-20"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="text-center">
        <motion.p
          className="text-[2vw] text-emerald-400 font-semibold tracking-widest uppercase mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          One Monorepo
        </motion.p>

        <div className="overflow-hidden">
          <motion.h1
            className="text-[8vw] font-['Plus_Jakarta_Sans'] font-extrabold leading-none text-white tracking-tighter"
            initial={{ opacity: 0, y: "100%" }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Two Worlds.
          </motion.h1>
        </div>
      </div>
    </motion.div>
  );
}
