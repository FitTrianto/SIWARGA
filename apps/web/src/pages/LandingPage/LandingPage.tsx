import { AnnouncementBar } from "./AnnouncementBar";
import { Header } from "./Header";
import { HeroSection } from "./HeroSection";
import { PersonaSection } from "./PersonaSection";
import { FeaturesSection } from "./FeaturesSection";
import { CalculatorSection } from "./CalculatorSection";
import { PricingSection } from "./PricingSection";
import { RegistrationForm } from "./RegistrationForm";
import { TestimonialSection } from "./TestimonialSection";
import { CtaStrip } from "./CtaStrip";
import { Footer } from "./Footer";
import { KontenLanding } from "../../lib/adminData";

interface LandingPageProps {
  /** Navigasi state-based: "landing" | "login" | halaman dokumen hukum. */
  onNavigate?: (page: string) => void;
  /** Konten hero/fitur/harga/persona yang dikelola System Admin di /admin. */
  konten?: KontenLanding;
}

export function LandingPage({ onNavigate, konten }: LandingPageProps) {
  return (
    <div className="min-h-dvh bg-[#fafcfa] text-[#0f172a] font-body-md antialiased selection:bg-emerald-100 selection:text-emerald-900">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-bold focus:shadow-lg"
        href="#konten-utama"
      >
        Lewati ke konten utama
      </a>
      <Header onNavigate={onNavigate} />
      <main id="konten-utama" tabIndex={-1} className="w-full pt-20 overflow-hidden">
        <div className="flex flex-col w-full">
          <AnnouncementBar />
          <HeroSection konten={konten} />
          <PersonaSection konten={konten} />
          <FeaturesSection konten={konten} />
          <CalculatorSection />
          <PricingSection konten={konten} />
          <RegistrationForm onNavigate={onNavigate} />
          <TestimonialSection />
          <CtaStrip />
        </div>
      </main>
      <Footer onNavigate={onNavigate} />
    </div>
  );
}
