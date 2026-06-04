import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-900/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div
        className="text-[5vw] font-['Plus_Jakarta_Sans'] font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500 mb-[4vw]"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        Built to Scale.
      </motion.div>

      <motion.div
        className="flex gap-[4vw] items-center"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.8 }}
      >
        <div className="flex flex-col items-center">
          <div className="text-[2vw] text-emerald-400 font-bold">CashClip</div>
          <div className="text-[1vw] text-slate-400">Mobile Rewards</div>
        </div>
        <div className="w-[2px] h-[4vw] bg-slate-700" />
        <div className="flex flex-col items-center">
          <div className="text-[2vw] text-blue-400 font-bold">AB Sustainability</div>
          <div className="text-[1vw] text-slate-400">Corporate Investments</div>
        </div>
      </motion.div>
    </motion.div>
  );
}
