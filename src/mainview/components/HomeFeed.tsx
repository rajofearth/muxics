import { memo, useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useShallow } from "zustand/react/shallow";
import { Play, Disc3, ListMusic, Music } from "lucide-react";
import type { Track, Playlist, NavView } from "../types";

export const HomeFeed = memo(function HomeFeed({
  onNavigate,
}: {
  onNavigate?: (view: NavView, id?: string) => void;
}) {
  const { homeFeed, auth, loadHomeFeed, playTrack } = usePlayerStore(
    useShallow((s) => ({
      homeFeed: s.homeFeed,
      auth: s.auth,
      loadHomeFeed: s.loadHomeFeed,
      playTrack: s.playTrack,
    })),
  );

  useEffect(() => {
    console.log("[HomeFeed] useEffect check:", {
      loggedIn: auth.loggedIn,
      sections: homeFeed.sections.length,
      loading: homeFeed.loading,
    });
    if (auth.loggedIn && homeFeed.sections.length === 0 && !homeFeed.loading) {
      console.log("[HomeFeed] Triggering loadHomeFeed");
      void loadHomeFeed();
    }
  }, [auth.loggedIn, homeFeed.sections.length, homeFeed.loading, loadHomeFeed]);

  if (homeFeed.loading && homeFeed.sections.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary gap-3">
        <div className="w-10 h-10 border-2 border-app-text-tertiary border-t-app-text-primary rounded-full animate-spin" />
        <div className="text-sm font-medium tracking-wide">
          Fetching your music...
        </div>
      </div>
    );
  }

  if (homeFeed.error && homeFeed.sections.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary p-8 text-center gap-4">
        <div className="text-sm text-red-400/80 bg-red-400/10 px-4 py-2 rounded-lg border border-red-400/20 max-w-md">
          {homeFeed.error}
        </div>
        <button
          onClick={() => void loadHomeFeed()}
          className="px-5 py-2 rounded-full bg-app-elevated border border-app-border-strong text-[13px] text-app-text-primary hover:bg-app-active transition-all"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!auth.loggedIn) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary p-8 text-center gap-4">
        <Disc3 size={48} strokeWidth={1} className="opacity-20 mb-2" />
        <div className="text-base font-semibold text-app-text-primary">
          Sign in to YouTube Music
        </div>
        <div className="text-sm max-w-xs text-app-text-tertiary">
          Connect your account to see your personalized "Listen again", "Quick
          picks", and more.
        </div>
      </div>
    );
  }

  const handleItemClick = (
    item: Track | Playlist,
    sectionItems: (Track | Playlist)[],
    _sectionTitle: string,
  ) => {
    if ("title" in item) {
      // It's a track
      const tracksOnly = sectionItems.filter((i): i is Track => "title" in i);
      playTrack(item, tracksOnly);
    } else if (onNavigate) {
      // Check if it's an album or playlist based on our type detection
      const view = item.type === "album" ? "album_detail" : "playlist_detail";
      onNavigate(view, item.id);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto pb-12 pt-4 no-scrollbar">
      {homeFeed.sections.map((section, idx) => {
        const isQuickPicks = section.title
          .toLowerCase()
          .includes("quick picks");
        const isListenAgain = section.title
          .toLowerCase()
          .includes("listen again");

        return (
          <section key={`${section.title}-${idx}`} className="mb-10 last:mb-0">
            <div className="px-8 mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-app-text-primary tracking-tight">
                {section.title}
              </h2>
            </div>

            {isQuickPicks ? (
              /* Quick Picks Grid: 4 rows high, horizontally scrollable chunks */
              <div className="flex overflow-x-auto gap-4 px-8 pb-4 scroll-smooth scrollbar-none snap-x">
                <div
                  className="grid grid-flow-col gap-x-8 gap-y-2 snap-start"
                  style={{ gridTemplateRows: "repeat(4, minmax(0, 1fr))" }}
                >
                  {section.items.map((item) => {
                    const isTrack = "title" in item;
                    const title = isTrack ? item.title : item.name;
                    const subtitle = isTrack ? item.artist : item.author;

                    return (
                      <button
                        key={item.id}
                        onClick={() =>
                          handleItemClick(item, section.items, section.title)
                        }
                        className="flex items-center gap-3 w-[280px] p-2 rounded-lg hover:bg-app-hover transition-colors group text-left"
                      >
                        <div className="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-app-elevated shadow-sm">
                          {item.picture ? (
                            <img
                              src={item.picture}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              {isTrack ? (
                                <Music
                                  size={14}
                                  className="text-app-text-tertiary"
                                />
                              ) : (
                                <ListMusic
                                  size={14}
                                  className="text-app-text-tertiary"
                                />
                              )}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            {isTrack ? (
                              <Play
                                size={14}
                                className="fill-white text-white ml-0.5"
                              />
                            ) : (
                              <ListMusic size={14} className="text-white" />
                            )}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-app-text-primary truncate mb-0.5">
                            {title}
                          </div>
                          <div className="text-[11px] text-app-text-tertiary truncate">
                            {subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Standard Horizontal Scroll */
              <div className="flex overflow-x-auto gap-4 px-8 pb-4 scroll-smooth scrollbar-none snap-x">
                {section.items.map((item) => {
                  const isTrack = "title" in item;
                  const title = isTrack ? item.title : item.name;
                  const subtitle = isTrack ? item.artist : item.author;
                  const picture = item.picture;
                  const itemWidth = isListenAgain ? "w-[120px]" : "w-[150px]";

                  return (
                    <button
                      key={item.id}
                      onClick={() =>
                        handleItemClick(item, section.items, section.title)
                      }
                      className={`group flex-shrink-0 ${itemWidth} text-left transition-all snap-start`}
                    >
                      <div
                        className={`aspect-square ${isTrack ? "rounded-xl" : "rounded-lg"} bg-app-elevated mb-3 overflow-hidden shadow-md group-hover:shadow-xl transition-all relative ring-1 ring-inset ring-white/5`}
                      >
                        {picture ? (
                          <img
                            src={picture}
                            alt={title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-app-border-strong">
                            {isTrack ? (
                              <Disc3
                                className="text-app-text-tertiary w-1/3 h-1/3 opacity-40"
                                strokeWidth={1.5}
                              />
                            ) : (
                              <ListMusic
                                className="text-app-text-tertiary w-1/3 h-1/3 opacity-40"
                                strokeWidth={1.5}
                              />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                          <div className="w-10 h-10 rounded-full bg-app-text-primary shadow-2xl flex items-center justify-center translate-y-2 group-hover:translate-y-0 transition-transform">
                            {isTrack ? (
                              <Play
                                size={18}
                                className="fill-app-bg text-app-bg ml-1"
                              />
                            ) : (
                              <ListMusic size={18} className="text-app-bg" />
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-[13px] font-semibold text-app-text-primary line-clamp-1 leading-tight mb-1">
                        {title}
                      </div>
                      <div className="text-[11.5px] text-app-text-tertiary line-clamp-1">
                        {subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      <div className="h-4" />
    </div>
  );
});
