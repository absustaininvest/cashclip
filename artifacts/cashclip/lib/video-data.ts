export interface VideoItem {
  id: string;
  title: string;
  channel: string;
  views: string;
  duration: string;
  category: string;
  color: string;
  icon: string;
  reward: number;
}

const videoPool: Array<Omit<VideoItem, "id" | "reward" | "views" | "duration">> = [
  { title: "How to Build Passive Income Streams", channel: "TechVibe", category: "Tech", color: "#E57373", icon: "play-circle" },
  { title: "Top 10 Apps That Pay You Real Money", channel: "GameZone", category: "Gaming", color: "#81C784", icon: "film" },
  { title: "Morning Routine for Productivity", channel: "LifeHacks", category: "Lifestyle", color: "#64B5F6", icon: "tv" },
  { title: "Ultimate Gaming Setup Tour 2026", channel: "MusicDrop", category: "Gaming", color: "#FFD54F", icon: "video" },
  { title: "Learn Coding in 30 Days Challenge", channel: "SportsPulse", category: "Tech", color: "#CE93D8", icon: "play-circle" },
  { title: "Best Budget Smartphones Reviewed", channel: "LOLDaily", category: "Tech", color: "#80DEEA", icon: "film" },
  { title: "Make $500 This Weekend — Side Hustle", channel: "MoneyMoves", category: "Finance", color: "#FFAB91", icon: "tv" },
  { title: "5 Habits That Changed My Life", channel: "LifeHacks", category: "Lifestyle", color: "#A5D6A7", icon: "play-circle" },
  { title: "PS6 vs Xbox Series X — Who Wins?", channel: "GameZone", category: "Gaming", color: "#EF9A9A", icon: "video" },
  { title: "AI Tools That Actually Save You Time", channel: "TechVibe", category: "Tech", color: "#90CAF9", icon: "film" },
  { title: "Road Trip Across the Country Vlog", channel: "WanderlustTV", category: "Lifestyle", color: "#FFF176", icon: "play-circle" },
  { title: "Top Underrated Songs This Week", channel: "MusicDrop", category: "Music", color: "#F48FB1", icon: "tv" },
  { title: "NBA Highlights — Best Plays of 2026", channel: "SportsPulse", category: "Sports", color: "#80CBC4", icon: "video" },
  { title: "Crypto for Beginners — Full Guide", channel: "MoneyMoves", category: "Finance", color: "#BCAAA4", icon: "film" },
  { title: "Unboxing the World's Fastest Laptop", channel: "GadgetGuru", category: "Tech", color: "#B0BEC5", icon: "play-circle" },
  { title: "Home Workout — Zero Equipment Needed", channel: "FitForward", category: "Sports", color: "#A1887F", icon: "tv" },
  { title: "Lofi Beats to Study and Earn To", channel: "MusicDrop", category: "Music", color: "#CE93D8", icon: "video" },
  { title: "Meal Prep in 1 Hour for the Whole Week", channel: "LifeHacks", category: "Lifestyle", color: "#80CBC4", icon: "film" },
  { title: "Best Free Games You Should Play Now", channel: "GameZone", category: "Gaming", color: "#FFCC80", icon: "play-circle" },
  { title: "Stock Market Explained in 10 Minutes", channel: "MoneyMoves", category: "Finance", color: "#EF9A9A", icon: "tv" },
  { title: "Headphone Shootout: $30 vs $300", channel: "GadgetGuru", category: "Tech", color: "#90CAF9", icon: "video" },
  { title: "Soccer Skills That Will Blow Your Mind", channel: "SportsPulse", category: "Sports", color: "#A5D6A7", icon: "film" },
  { title: "How to Meditate for Absolute Beginners", channel: "LifeHacks", category: "Lifestyle", color: "#FFAB91", icon: "play-circle" },
  { title: "Top 5 Money Mistakes to Avoid in 2026", channel: "TechVibe", category: "Finance", color: "#FFF176", icon: "tv" },
  { title: "New Music Drops You Missed This Month", channel: "MusicDrop", category: "Music", color: "#F48FB1", icon: "video" },
];

function generateViews(): string {
  const num = Math.floor(Math.random() * 95000) + 500;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function generateDuration(): string {
  const mins = Math.floor(Math.random() * 12) + 1;
  const secs = Math.floor(Math.random() * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function generateVideos(count: number): VideoItem[] {
  const capped = Math.min(count, videoPool.length);
  return Array.from({ length: capped }, (_, i) => ({
    ...videoPool[i],
    id: `video_${i}`,
    views: generateViews(),
    duration: generateDuration(),
    reward: parseFloat((Math.random() * 0.06 + 0.04).toFixed(2)),
  }));
}

export const adVideos = [
  { id: "ad_1", brand: "CashClip", duration: 15, reward: 0.05, color: "#00E676", description: "Complete this featured earning opportunity" },
  { id: "ad_2", brand: "CashClip", duration: 20, reward: 0.07, color: "#42A5F5", description: "Unlock a new reward challenge" },
  { id: "ad_3", brand: "CashClip", duration: 25, reward: 0.08, color: "#FFD600", description: "Check today's recommended task" },
  { id: "ad_4", brand: "CashClip", duration: 30, reward: 0.10, color: "#FF7043", description: "Finish a limited-time offer" },
];
