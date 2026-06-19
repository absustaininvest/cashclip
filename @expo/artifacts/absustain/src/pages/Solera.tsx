import { ArrowUpRight, UtensilsCrossed, MapPin, Clock, Mail, ExternalLink, Star } from "lucide-react";
import { Link } from "wouter";
import { Seo } from "../components/Seo";

export default function Solera() {
  return (
    <div className="pt-32 pb-24 px-6 max-w-6xl mx-auto">
      <Seo
        title="Solera Restaurant | AB Sustainability Investments"
        description="Solera Restaurant — aged in tradition, served with soul. A modern hospitality and food service venture in Lake Worth Beach, FL, part of AB Sustainability Investments."
        path="/ventures/solera"
        image={{ url: "https://absustaininvest.com/absustain/solera-logo.jpeg", width: 1116, height: 1140 }}
      />

      {/* Hero */}
      <div className="text-center mb-24">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#8B4A35]/10 border border-[#8B4A35]/20 mb-6">
          <UtensilsCrossed className="w-3.5 h-3.5 text-[#D4A540]" />
          <span className="text-[#D4A540] text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase">Hospitality & Food Service — Lake Worth Beach, FL</span>
        </div>
        <div className="mb-8">
          <img
            src={`${import.meta.env.BASE_URL}solera-logo.jpeg`}
            alt="Solera Restaurant"
            className="w-48 md:w-64 mx-auto object-contain rounded-2xl"
          />
        </div>
        <h1 className="font-['Space_Grotesk'] font-bold text-6xl md:text-7xl text-white tracking-tight mb-4">Solera</h1>
        <p className="text-[#D4A540] font-serif italic text-2xl mb-6">Aged in Tradition. Served with Soul.</p>
        <p className="text-white/50 max-w-2xl mx-auto text-lg leading-relaxed">
          A modern restaurant concept rooted in hospitality and quality. Solera draws its name from the traditional aging method — blending the best of what came before with the innovation of what's next. Every detail is designed to deliver an experience that feels both timeless and fresh.
        </p>
        <div className="flex items-center justify-center gap-4 mt-10 flex-wrap">
          <div className="flex items-center gap-2 px-6 py-3.5 rounded-full border border-[#D4A540]/30 bg-[#D4A540]/5 text-[#D4A540] font-['Space_Grotesk'] font-bold text-sm">
            <UtensilsCrossed className="w-4 h-4" />
            Relocating — New Venue Being Secured
          </div>
          <Link
            href="/ventures"
            className="flex items-center gap-2 border border-white/10 text-white/60 hover:text-white hover:border-white/20 py-3.5 px-8 rounded-full font-['Space_Grotesk'] font-bold text-sm transition-colors"
          >
            View All Ventures
          </Link>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid md:grid-cols-3 gap-5 mb-24">
        {[
          { icon: <MapPin className="w-5 h-5 text-[#D4A540]" />, label: "Location", value: "Lake Worth Beach, FL", sub: "Greater Palm Beach Area" },
          { icon: <Star className="w-5 h-5 text-[#D4A540]" />, label: "Cuisine", value: "Contemporary American", sub: "Timeless flavors, fresh innovation" },
          { icon: <Clock className="w-5 h-5 text-[#D4A540]" />, label: "Status", value: "Relocating", sub: "Securing a new venue in the area" },
        ].map((item) => (
          <div key={item.label} className="p-6 rounded-2xl bg-[#8B4A35]/5 border border-[#8B4A35]/15 text-center">
            <div className="flex justify-center mb-3">{item.icon}</div>
            <p className="text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase mb-1">{item.label}</p>
            <p className="text-white font-['Space_Grotesk'] font-bold text-base mb-0.5">{item.value}</p>
            <p className="text-white/30 text-xs">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Signature dishes */}
      <div className="mb-24">
        <div className="text-center mb-12">
          <div className="section-label">The Menu</div>
          <h2 className="font-['Space_Grotesk'] text-3xl md:text-4xl font-bold text-white mt-4">A Few of Our Favorites</h2>
          <p className="text-white/40 mt-3 max-w-xl mx-auto">Every dish tells a story of tradition, craft, and care — made to be remembered.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              name: "Cordon Bleu",
              icon: "🍗",
              desc: "A classic elevated — tender chicken wrapped with premium ham and melted Swiss, golden-crusted and served with a rich Dijon cream sauce.",
            },
            {
              name: "Coastal Cobb",
              icon: "🥗",
              desc: "Fresh romaine, avocado, grilled shrimp, crispy bacon, and a zesty lemon vinaigrette — coastal Florida on a plate.",
            },
            {
              name: "Lentil Soup",
              icon: "🍲",
              desc: "A slow-simmered house recipe with green lentils, aromatic spices, and a finishing drizzle of extra virgin olive oil. Comfort, perfected.",
            },
          ].map((dish) => (
            <div key={dish.name} className="rounded-2xl bg-[#8B4A35]/5 border border-[#8B4A35]/15 p-8 hover:bg-[#8B4A35]/10 transition-colors">
              <div className="text-5xl mb-5">{dish.icon}</div>
              <h3 className="font-['Space_Grotesk'] font-bold text-white text-xl mb-3">{dish.name}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{dish.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* About section */}
      <div className="mb-24 flex flex-col md:flex-row gap-12 items-center">
        <div className="flex-1">
          <div className="section-label mb-4">Our Story</div>
          <h2 className="font-['Space_Grotesk'] text-3xl md:text-4xl font-bold text-white mb-5">The solera method is our philosophy.</h2>
          <p className="text-white/50 text-lg leading-relaxed mb-4">
            In winemaking, the solera method blends vintages from different years — the old enriching the new, the new breathing life into the old. We cook the same way. Every recipe at Solera honors the traditions that came before it, while being reimagined for today's table.
          </p>
          <p className="text-white/40 leading-relaxed">
            Rooted in Lake Worth Beach, FL — a community with deep cultural roots and a growing culinary scene — Solera is built to be a gathering place. Not just a restaurant. A home.
          </p>
        </div>
        <div className="flex-1 w-full">
          <div className="aspect-[4/3] rounded-3xl bg-gradient-to-br from-[#1A0D08] via-[#0F0A07] to-[#06060E] border border-[#8B4A35]/20 flex items-center justify-center relative overflow-hidden p-10">
            <img
              src={`${import.meta.env.BASE_URL}solera-logo.jpeg`}
              alt="Solera Restaurant"
              className="w-full max-w-[280px] object-contain rounded-2xl opacity-90"
            />
          </div>
        </div>
      </div>

      {/* Contact & Online */}
      <div className="mb-16 grid md:grid-cols-2 gap-5">
        <div className="rounded-2xl bg-[#8B4A35]/5 border border-[#8B4A35]/15 p-8">
          <UtensilsCrossed className="w-8 h-8 text-[#D4A540] mb-4" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-xl mb-2">Order Online</h3>
          <p className="text-white/40 text-sm mb-5">Fresh food from Solera, available for pickup via our Square ordering site.</p>
          <a
            href="https://solera-restaurant.square.site"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#8B4A35] hover:bg-[#A0522D] text-white py-3 px-6 rounded-full font-['Space_Grotesk'] font-bold text-sm transition-colors"
          >
            solera-restaurant.square.site <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-8">
          <Mail className="w-8 h-8 text-[#D4A540] mb-4" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-xl mb-2">Partnership & Catering Inquiries</h3>
          <p className="text-white/40 text-sm mb-5">Events, catering, collaborations, and media inquiries — reach out directly.</p>
          <a
            href="mailto:supportpr@absustaininvest.com?subject=Solera Restaurant Inquiry"
            className="inline-flex items-center gap-2 border border-[#8B4A35]/40 hover:border-[#D4A540]/40 text-[#D4A540] py-3 px-6 rounded-full font-['Space_Grotesk'] font-bold text-sm transition-colors"
          >
            <Mail className="w-4 h-4" />
            supportpr@absustaininvest.com
          </a>
        </div>
      </div>

    </div>
  );
}
