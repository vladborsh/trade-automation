drop table if exists news_reactions;
drop table if exists news_assets;
drop table if exists news_cluster_members;
drop table if exists news_clusters;
drop table if exists raw_news;
-- pg_trgm is left installed: other work may rely on it, and dropping a shared extension in an
-- undo is a wider blast radius than this migration's own scope.
