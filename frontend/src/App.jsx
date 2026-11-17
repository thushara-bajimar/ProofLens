import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { LandingPage } from './pages/LandingPage.jsx';
import { VerifyPage } from './pages/VerifyPage.jsx';
import { ResultPage } from './pages/ResultPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { DemoPage } from './pages/DemoPage.jsx';
import { RecordPage } from './pages/RecordPage.jsx';
import { HowItWorksPage } from './pages/HowItWorksPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LandingPage />} />
          <Route path="verify" element={<VerifyPage />} />
          <Route path="result" element={<ResultPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="demo" element={<DemoPage />} />
          <Route path="record/:id" element={<RecordPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<div className="container page"><h1>Page not found</h1><Link to="/">Go home</Link></div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
