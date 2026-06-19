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
import { ROUTES } from "./public-routes";

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
      <Route path={ROUTES.SC_PORTAL}>
        <Suspense fallback={null}>
          <AdminGate />
        </Suspense>
      </Route>
      <Route>
        <PageLayout>
          <Switch>
            <Route path={ROUTES.HOME} component={Home} />
            <Route path={ROUTES.VENTURES} component={Ventures} />
            <Route path={ROUTES.VENTURES_SOLERA} component={Solera} />
            <Route path={ROUTES.ABOUT} component={About} />
            <Route path={ROUTES.INVESTORS} component={Investors} />
            <Route path={ROUTES.CONTACT} component={Contact} />
            <Route path={ROUTES.PRESS} component={PressKit} />
            <Route path={ROUTES.PRIVACY} component={CashClipPrivacy} />
            <Route path={ROUTES.TERMS} component={CashClipTerms} />
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
