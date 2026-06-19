import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),  // Logo
      setTimeout(() => setPhase(2), 1000), // Name
      setTimeout(() => setPhase(3), 1600), // CTA
      setTimeout(() => setPhase(4), 3800), // Exit (loop back)
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)', y: -50 }}
      transition={{ duration: 1 }}
    >
      <motion.div 
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#00f260]/15 via-transparent to-transparent pointer-events-none"
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex flex-col items-center">
        
        <motion.div
          initial={{ opacity: 0, scale: 0, rotate: -45 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 0, scale: 0, rotate: -45 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="mb-[4vh] relative"
        >
          {/* Using a pure CSS logo representation since asset might be missing or unlinked properly, it's safer and cleaner */}
          <div className="w-[18vw] h-[18vw] bg-gradient-to-br from-[#00f260] to-[#00b84c] rounded-[4vw] shadow-[0_20px_50px_rgba(0,242,96,0.4)] flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-white/20" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 40%, 0 60%)' }} />
            <svg width="8vw" height="8vw" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </motion.div>

        <div className="overflow-hidden mb-[2vh]">
          <motion.div
            className="text-[10vw] font-black text-white tracking-tighter uppercase leading-none drop-shadow-2xl"
            initial={{ opacity: 0, y: "100%" }}
            animate={phase >= 2 ? { opacity: 1, y: "0%" } : { opacity: 0, y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            CashClip
          </motion.div>
        </div>

        <motion.div
          className="text-[2.5vw] text-[#00f260] font-bold tracking-[0.3em] uppercase bg-[#00f260]/10 px-[3vw] py-[1.5vh] rounded-full border border-[#00f260]/30 backdrop-blur-md mt-[2vh]"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          whileHover={{ scale: 1.05 }} // Visual only, not interactive
        >
          Download Now
        </motion.div>
      </div>
    </motion.div>
  );
}
