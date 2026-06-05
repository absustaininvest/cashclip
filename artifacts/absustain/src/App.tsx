import { Suspense, lazy, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { trackPageview, initAnalyticsClickTracking } from "./lib/analytics";
import NotFound from "@/pages/not-found";
import { PageLayout } from "./components/layout/PageLayout";
import Home from "./pages/Home";
import Ventures from "./pages/Ventures";
import About from "./pages/About";
import Investors from "./pages/Investors";
import Contact from "./pages/Contact";
import PressKit from "./pages/PressKit";
import Solera from "./pages/Solera";
import CashClipPrivacy from "./pages/CashClipPrivacy";
import CashClipTerms from "./pages/CashClipTerms";
import { LanguageProvider } from "./lib/i18n";

const AdminGate = lazy(() => import("./pages/AdminGate"));

function AnalyticsTracker() {
  const [location] = useLocation();
  useEffect(() => {
    initAnalyticsClickTracking();
  }, []);
  // Fire a page view on the initial load and on every client-side route change.
  useEffect(() => {
    trackPageview();
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/sc-portal">
        <Suspense fallback={null}>
          <AdminGate />
        </Suspense>
      </Route>
      <Route>
        <PageLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/ventures" component={Ventures} />
            <Route path="/ventures/solera" component={Solera} />
            <Route path="/about" component={About} />
            <Route path="/investors" component={Investors} />
            <Route path="/contact" component={Contact} />
            <Route path="/press" component={PressKit} />
            <Route path="/cashclip/privacy" component={CashClipPrivacy} />
            <Route path="/cashclip/terms" component={CashClipTerms} />
            <Route component={NotFound} />
          </Switch>
        </PageLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <LanguageProvider>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
        <AnalyticsTracker />
        <Router />
      </WouterRouter>
    </LanguageProvider>
  );
}

export default App;
