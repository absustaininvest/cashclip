import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),  // Background pulse
      setTimeout(() => setPhase(2), 600),  // "Get Paid"
      setTimeout(() => setPhase(3), 1200), // Card appears
      setTimeout(() => setPhase(4), 1800), // Numbers roll up
      setTimeout(() => setPhase(5), 3200), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-20 overflow-hidden"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ scale: 0.8, opacity: 0, rotate: 5, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div 
        className="absolute w-[120vw] h-[120vw] bg-[#0052ff]/15 rounded-full blur-[100px] pointer-events-none"
        initial={{ scale: 0 }}
        animate={phase >= 1 ? { scale: 1 } : { scale: 0 }}
        transition={{ duration: 2.5, ease: "easeOut" }}
      />

      <div className="flex flex-col items-center z-10 w-full relative">
        <motion.div
          className="text-center mb-[8vh] flex flex-col items-center"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
        >
          <div className="overflow-hidden">
            <h2 className="text-[10vw] font-black text-white leading-[0.8] tracking-tighter uppercase drop-shadow-2xl">
              GET PAID
            </h2>
          </div>
          <div className="overflow-hidden">
            <h2 className="text-[10vw] font-black text-transparent bg-clip-text bg-gradient-to-r from-[#0052ff] to-[#00f260] leading-[1.1] tracking-tighter uppercase drop-shadow-lg">
              INSTANTLY.
            </h2>
          </div>
        </motion.div>

        <motion.div 
          className="relative"
          initial={{ opacity: 0, scale: 0.5, rotateX: 45 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, rotateX: 0 } : { opacity: 0, scale: 0.5, rotateX: 45 }}
          transition={{ duration: 1, type: "spring", stiffness: 150, damping: 20 }}
          style={{ perspective: 1000 }}
        >
          {/* Mock PayPal Card */}
          <div className="bg-[#003087]/30 border border-[#0079C1]/50 backdrop-blur-2xl rounded-[3vw] p-[4vw] flex flex-col items-center justify-center shadow-[0_0_80px_rgba(0,121,193,0.4)] w-[40vw] relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[40%] bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
            <h3 className="text-[4vw] font-bold text-white italic tracking-wider mb-[2vh]">PayPal</h3>
            
            <motion.div 
              className="text-[5vw] text-[#00f260] font-black tracking-tight"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6 }}
            >
              +$150.00
            </motion.div>
            
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-45deg]"
              initial={{ x: '-200%' }}
              animate={phase >= 4 ? { x: '200%' } : { x: '-200%' }}
              transition={{ duration: 1.5, delay: 0.5 }}
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
