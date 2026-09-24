import { createBrowserRouter } from "react-router";
import EventPublic from "./pages/EventPublic";
import Home from "./pages/Home";
import Manage from "./pages/manage/Manage";
import NewEvent from "./pages/NewEvent";
import NotFound from "./pages/NotFound";
import Recover from "./pages/Recover";
import TeamRegister from "./pages/TeamRegister";
import Tournaments from "./pages/Tournaments";
import WeighIn from "./pages/WeighIn";

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/new", element: <NewEvent /> },
  { path: "/tournaments", element: <Tournaments /> },
  { path: "/recover", element: <Recover /> },
  { path: "/e/:slug", element: <EventPublic /> },
  { path: "/e/:slug/team", element: <TeamRegister /> },
  { path: "/e/:slug/manage/:tab?", element: <Manage /> },
  { path: "/e/:slug/weigh-in", element: <WeighIn /> },
  { path: "*", element: <NotFound /> },
]);
