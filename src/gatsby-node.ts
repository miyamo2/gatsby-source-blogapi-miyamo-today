import type { GatsbyNode } from "gatsby";
import { createFileNodeFromBuffer, createRemoteFileNode } from "gatsby-source-filesystem";
import { request } from "graphql-request";
import { format } from "@formkit/tempo";
import {
  type SourceNodesQuery,
  SourceNodesDocument,
  type SourceNodesQueryVariables,
  type InputMaybe,
} from "./graphqlgen";

export const pluginOptionsSchema: GatsbyNode["pluginOptionsSchema"] = ({ Joi }) => {
  return Joi.object({
    url: Joi.string().required(),
    token: Joi.string().required(),
  });
};

export const onPreInit: GatsbyNode["onPreInit"] = ({ reporter }, pluginOptions) => {
  if (!pluginOptions.url) {
    reporter.panic("gatsby-source-blogapi-miyamo-today: url is required");
  }
  if (!pluginOptions.token) {
    reporter.panic("gatsby-source-blogapi-miyamo-today: token is required");
  }
}

export const sourceNodes: GatsbyNode["sourceNodes"] = async ({
  reporter,
  actions,
  cache,
  createContentDigest,
}, pluginOptions) => {
  reporter.info("gatsby-source-blogapi-miyamo-today: start sourceNodes");
  const { createNode, createNodeField } = actions;

  const url = pluginOptions.url;
  if (!url || typeof url !== "string") {
    reporter.panic("endpoint must not to be null or undefined");
    return  // this return statement is not executed, but for the purpose of type guarding.
  }
  const token = pluginOptions.token;
  if (!token || typeof token !== "string") {
    reporter.panic("token must not to be null or undefined");
    return
  }

  let doContinue = true;
  let after: InputMaybe<string> = null;

  const createNodePromises = Array<Promise<void>>();
  while (doContinue) {
    const data: SourceNodesQuery = await request<SourceNodesQuery, SourceNodesQueryVariables>(
      url,
      SourceNodesDocument,
      {
        after: after,
        first: 24,
      },
      {
        authorization: token ? `Bearer ${token}` : "",
      }
    );
    if (!data) {
      reporter.error("failed to get articles");
      continue;
    }
    reporter.info(`fetched ${data.articles.edges.length} articles`);
    
    createNodePromises.push(...data.articles.edges.map(async (edge) => {
      const articleNode = edge.node;
      if (
        articleNode.thumbnailUrl === null ||
        articleNode.thumbnailUrl === undefined ||
        articleNode.thumbnailUrl.length === 0
      ) {
        return;
      }

      const thumbnailNode = await createRemoteFileNode({
        url: articleNode.thumbnailUrl,
        cache,
        createNode: createNode,
        createNodeId: (): string => {
          return `ArticleImage:${articleNode.id}`;
        },
      });

      createNodeField({
        node: thumbnailNode,
        name: "ArticleImage",
        value: "true",
      });

      createNodeField({
        node: thumbnailNode,
        name: "link",
        value: articleNode.thumbnailUrl,
      });

      const rawContent = articleNode.content.replaceAll(`\\n`, `\n`);
      const content = `---
id: "${articleNode.id}"
title: "${articleNode.title}"
createdAt: "${format(new Date(articleNode.createdAt), "YYYY-MM-DDTHH:mm:ssZ")}"
updatedAt: "${format(new Date(articleNode.updatedAt), "YYYY-MM-DDTHH:mm:ssZ")}"
thumbnail: "${articleNode.thumbnailUrl}"
tags: [${articleNode.tags.edges
        .map((edge) => {
          return `{"id": "${edge.cursor}", "name": "${edge.node.name}"}`;
        })
        .join(", ")}]
---
${rawContent}`;
      const contentNode = await createFileNodeFromBuffer({
        buffer: Buffer.from(await new Blob([content], { type: "text/markdown" }).arrayBuffer()),
        cache,
        createNode,
        createNodeId: (): string => {
          return `ArticleContent:${articleNode.id}`;
        },
        hash: createContentDigest(content),
        ext: ".md",
      });

      createNodeField({
        node: contentNode,
        name: "ArticleContent",
        value: "true",
      });

      createNodeField({
        node: contentNode,
        name: "link",
        value: content,
      });
      return;
    }));

    const { hasNextPage, endCursor } = data.articles.pageInfo;
    doContinue = hasNextPage;
    after = endCursor;
  }
  await Promise.all(createNodePromises);
  reporter.success("gatsby-source-blogapi-miyamo-today: end sourceNodes");
};
