import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { HelmetProvider, Helmet } from 'react-helmet-async';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { Preloader } from './components/Preloader';
import { LoadingPage } from './components/LoadingPage';
import Layout from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const UserDashboard = lazy(() => import('./pages/UserDashboard'));
const MerchantDashboard = lazy(() => import('./pages/MerchantDashboard'));
const CouponPage = lazy(() => import('./pages/CouponPage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const DemoStorePage = lazy(() => import('./pages/DemoStorePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// Protected Route Wrapper
function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode, adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingPage message="Loading session..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.email !== 'admin@couponvault.app' && user.email !== 'admin@123.com') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <HelmetProvider>
      <ToastProvider>
        <Preloader />
        <AuthProvider>
          <Router>
            <Helmet>
              <title>CouponVault – Premium Gift Card Marketplace</title>
            </Helmet>
            <Suspense fallback={<LoadingPage message="Loading application..." />}>
              <Routes>
                {/* Standalone validation endpoint */}
                <Route path="/coupon/:code" element={<ScanPage />} />
                <Route path="/store" element={<DemoStorePage />} />

                {/* App Layout Framework */}
                <Route path="/" element={<Layout />}>
                  <Route index element={<LandingPage />} />
                  <Route path="login" element={<LoginPage />} />
                  <Route path="userlogin" element={<LoginPage />} />
                  <Route path="companylogin" element={<LoginPage />} />
                  <Route path="adminlogin" element={<LoginPage />} />

                  <Route
                    path="dashboard"
                    element={<Navigate to="/dashboard/marketplace" replace />}
                  />
                  <Route
                    path="dashboard/:section"
                    element={
                      <ProtectedRoute>
                        <UserDashboard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="merchant"
                    element={<Navigate to="/merchant/overview" replace />}
                  />
                  <Route
                    path="merchant/:section"
                    element={
                      <ProtectedRoute>
                        <MerchantDashboard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="admin"
                    element={<Navigate to="/admin/overview" replace />}
                  />
                  <Route
                    path="admin/:section"
                    element={
                      <ProtectedRoute adminOnly>
                        <AdminDashboard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="my-coupon/:id"
                    element={
                      <ProtectedRoute>
                        <CouponPage />
                      </ProtectedRoute>
                    }
                  />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </Router>
        </AuthProvider>
      </ToastProvider>
    </HelmetProvider>
  );
}

export default App;
