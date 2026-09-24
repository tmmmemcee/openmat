import { createBrowserRouter } from "react-router";
import Brackets from "./pages/Brackets";
import EventPublic from "./pages/EventPublic";
import Follow from "./pages/Follow";
import MatBoard from "./pages/MatBoard";
import TableApp from "./pages/table/TableApp";
import Home from "./pages/Home";
import Manage from "./pages/manage/Manage";
import NewEvent from "./pages/NewEvent";
import NotFound from "./pages/NotFound";
import BoutSheets from "./pages/print/BoutSheets";
import PrintBrackets from "./pages/print/PrintBrackets";
import PrintQr from "./pages/print/PrintQr";
import Recover from "./pages/Recover";
import TeamRegister from "./pages/TeamRegister";
import TeamScores from "./pages/TeamScores";
import Tournaments from "./pages/Tournaments";
import WeighIn from "./pages/WeighIn";

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/new", element: <NewEvent /> },
  { path: "/tournaments", element: <Tournaments /> },
  { path: "/recover", element: <Recover /> },
  { path: "/e/:slug", element: <EventPublic /> },
  { path: "/e/:slug/team", element: <TeamRegister /> },
  { path: "/e/:slug/brackets", element: <Brackets /> },
  { path: "/e/:slug/mats", element: <MatBoard /> },
  { path: "/e/:slug/follow", element: <Follow /> },
  { path: "/e/:slug/teams", element: <TeamScores /> },
  { path: "/e/:slug/print/brackets", element: <PrintBrackets /> },
  { path: "/e/:slug/print/bouts", element: <BoutSheets /> },
  { path: "/e/:slug/print/qr", element: <PrintQr /> },
  { path: "/e/:slug/table/:mat", element: <TableApp /> },
  { path: "/e/:slug/manage/:tab?", element: <Manage /> },
  { path: "/e/:slug/weigh-in", element: <WeighIn /> },
  { path: "*", element: <NotFound /> },
]);
