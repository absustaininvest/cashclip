import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-20"
      initial={{ opacity: 0, rotateX: 90 }}
      animate={{ opacity: 1, rotateX: 0 }}
      exit={{ opacity: 0, scale: 1.2 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      style={{ perspective: 1000 }}
    >
      <div className="relative w-[60vw] h-[40vw] flex items-center justify-center">

        {/* Nodes connecting */}
        <motion.div
          className="absolute left-[10%] top-[30%] w-[10vw] h-[10vw] rounded-full border border-emerald-500/50 bg-emerald-500/10 flex items-center justify-center backdrop-blur-md"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <span className="text-[1.5vw] font-bold">Client Apps</span>
        </motion.div>

        <motion.div
          className="absolute right-[10%] bottom-[30%] w-[10vw] h-[10vw] rounded-full border border-blue-500/50 bg-blue-500/10 flex items-center justify-center backdrop-blur-md"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
        >
          <span className="text-[1.5vw] font-bold">PostgreSQL</span>
        </motion.div>

        {/* Central API */}
        <motion.div
          className="absolute w-[16vw] h-[16vw] rounded-2xl bg-slate-800/80 border border-slate-600 shadow-2xl flex flex-col items-center justify-center backdrop-blur-xl z-10"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
          <div className="text-[2.5vw] font-['Plus_Jakarta_Sans'] font-bold text-white">Express API</div>
          <div className="text-[1.2vw] text-slate-400 mt-2">Shared Backend</div>
        </motion.div>

      </div>
    </motion.div>
  );
}
