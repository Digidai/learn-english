import { Link, Outlet, useLocation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import type { Route } from "./+types/_app";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireAuth(request, context.cloudflare.env);
  return { user };
}

const tabs = [
  {
    path: "/today",
    label: "今日练习",
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
  },
  {
    path: "/input",
    label: "添加素材",
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  {
    path: "/corpus",
    label: "我的语料",
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    path: "/profile",
    label: "个人中心",
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    ),
  },
];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  // Hide bottom nav during practice sessions
  const isPractice = location.pathname.match(/^\/today\/[^/]+$/);

  return (
    <div className={`min-h-screen bg-gray-50 ${isPractice ? "" : "pb-20"}`}>
      {/* Main content */}
      <main className={isPractice ? "" : "max-w-lg mx-auto px-4 py-6"}>
        <Outlet />
      </main>

      {/* Bottom tab bar — hidden during practice */}
      {!isPractice && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-pb">
          <div className="max-w-lg mx-auto flex">
            {tabs.map((tab) => {
              const isActive = location.pathname === tab.path || location.pathname.startsWith(tab.path + "/");
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex-1 flex flex-col items-center py-2 pt-3 transition-colors ${
                    isActive
                      ? "text-blue-600"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {tab.icon(isActive)}
                  <span className="text-xs mt-1 font-medium">{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
