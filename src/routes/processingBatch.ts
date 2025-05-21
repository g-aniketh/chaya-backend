import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  prisma,
  Prisma,
  ProcessingStageStatus as PrismaProcessingStageStatus,
  createProcessingBatchSchema,
  processingBatchQuerySchema,
} from "@fyzanshaik/chaya-prisma-package";
import {
  authenticate,
  verifyAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth";
import { generateProcessingBatchCode } from "../helper";
import redisClient from "../lib/upstash-redis";

async function invalidateProcessingCache(batchId?: number | string) {
  const keysToDelete: string[] = [];
  const listKeys = await redisClient.keys("processing-batches:list:*");
  if (listKeys.length) keysToDelete.push(...listKeys);
  if (batchId) keysToDelete.push(`processing-batch:${batchId}`);
  if (keysToDelete.length) await redisClient.del(...keysToDelete);
}

type ExtendedProcessingStageStatus =
  | PrismaProcessingStageStatus
  | "SOLD_OUT"
  | "NO_STAGES";

async function processingBatchRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = (request as AuthenticatedRequest).user;
      try {
        const { crop, lotNo, procurementIds, firstStageDetails } =
          createProcessingBatchSchema.parse(request.body);
        const userId = authUser.id;

        if (!procurementIds || procurementIds.length === 0) {
          return reply
            .status(400)
            .send({ error: "At least one procurement ID must be provided." });
        }

        const procurements = await prisma.procurement.findMany({
          where: {
            id: { in: procurementIds },
            crop: { equals: crop, mode: "insensitive" },
            lotNo: lotNo,
            processingBatchId: null,
          },
        });

        if (procurements.length !== procurementIds.length) {
          return reply
            .status(400)
            .send({
              error:
                "One or more procurement IDs are invalid, do not match crop/lot, or are already batched.",
            });
        }

        const initialBatchQuantity = procurements.reduce(
          (sum, p) => sum + p.quantity,
          0,
        );
        if (initialBatchQuantity <= 0) {
          return reply
            .status(400)
            .send({ error: "Total quantity for the batch must be positive." });
        }

        const dateForBatchCode = new Date(firstStageDetails.dateOfProcessing);
        if (isNaN(dateForBatchCode.getTime())) {
          return reply
            .status(400)
            .send({
              error: "Invalid dateOfProcessing for batch code generation.",
            });
        }
        const uniqueProcessingBatchCode = await generateProcessingBatchCode(
          crop,
          lotNo,
          dateForBatchCode,
        );

        const result = await prisma.$transaction(
          async (tx) => {
            const newBatch = await tx.processingBatch.create({
              data: {
                batchCode: uniqueProcessingBatchCode,
                crop,
                lotNo,
                initialBatchQuantity,
                createdById: userId,
                procurements: { connect: procurementIds.map((id) => ({ id })) },
              },
            });

            const p1DateOfProcessing = new Date(
              firstStageDetails.dateOfProcessing,
            );
            if (isNaN(p1DateOfProcessing.getTime())) {
              throw new Error("Invalid dateOfProcessing for P1 stage.");
            }

            await tx.processingStage.create({
              data: {
                processingBatchId: newBatch.id,
                processingCount: 1,
                processMethod: firstStageDetails.processMethod,
                dateOfProcessing: p1DateOfProcessing,
                doneBy: firstStageDetails.doneBy,
                initialQuantity: initialBatchQuantity,
                status: "IN_PROGRESS",
                createdById: userId,
              },
            });

            return tx.processingBatch.findUnique({
              where: { id: newBatch.id },
              include: {
                processingStages: {
                  orderBy: { processingCount: "asc" },
                  take: 1,
                },
              },
            });
          },
          {
            maxWait: 10000,
            timeout: 10000,
          },
        );

        await invalidateProcessingCache();
        return reply.status(201).send({ batch: result });
      } catch (error: any) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2028"
        ) {
          console.error("Transaction timeout error:", error);
          return reply
            .status(500)
            .send({ error: "Server operation timed out, please try again." });
        }
        if (error.issues)
          return reply
            .status(400)
            .send({ error: "Invalid request data", details: error.issues });
        console.error("Create processing batch error:", error);
        return reply
          .status(500)
          .send({ error: "Server error creating processing batch" });
      }
    },
  );

  fastify.get(
    "/",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = processingBatchQuerySchema.parse(request.query);
      const cacheKey = `processing-batches:list:${JSON.stringify(query)}`;
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const page = query.page ?? 1;
        const limit = query.limit ?? 10;
        const skip = (page - 1) * limit;

        let where: Prisma.ProcessingBatchWhereInput = {};
        if (query.search) {
          where.OR = [
            { batchCode: { contains: query.search, mode: "insensitive" } },
            { crop: { contains: query.search, mode: "insensitive" } },
          ];
        }

        const allCandidateBatchesFromDb = await prisma.processingBatch.findMany(
          {
            where, 
            include: {
              processingStages: {
                orderBy: { processingCount: "desc" },
                include: {
                  dryingEntries: { orderBy: { day: "desc" }, take: 1 },
                  sales: { select: { quantitySold: true } },
                },
              },
              sales: { select: { quantitySold: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        );

        const transformedBatches = allCandidateBatchesFromDb.map((batch) => {
          const latestStage = batch.processingStages[0];
          let netAvailableFromLatestStage: number = 0;
          let statusForLatestStage: ExtendedProcessingStageStatus = "NO_STAGES";

          if (latestStage) {
            statusForLatestStage = latestStage.status;

            if (
              latestStage.status === PrismaProcessingStageStatus.IN_PROGRESS
            ) {
              netAvailableFromLatestStage =
                latestStage.dryingEntries[0]?.currentQuantity ??
                latestStage.initialQuantity;
            } else if (
              latestStage.status === PrismaProcessingStageStatus.FINISHED
            ) {
              const soldFromThisStage = latestStage.sales.reduce(
                (sum, sale) => sum + sale.quantitySold,
                0,
              );
              netAvailableFromLatestStage =
                (latestStage.quantityAfterProcess ?? 0) - soldFromThisStage;
              if (netAvailableFromLatestStage <= 0) {
                statusForLatestStage = "SOLD_OUT";
              }
            } else if (
              latestStage.status === PrismaProcessingStageStatus.CANCELLED
            ) {
              // No need to set to 0 as it's already initialized
            }
          } else {
            // No need to set to 0 as it's already initialized
          }

          const totalQuantitySoldFromBatchOverall = batch.sales.reduce(
            (sum, sale) => sum + sale.quantitySold,
            0,
          );

          return {
            id: batch.id,
            batchCode: batch.batchCode,
            crop: batch.crop,
            lotNo: batch.lotNo,
            initialBatchQuantity: batch.initialBatchQuantity,
            createdAt: batch.createdAt,
            latestStageSummary: latestStage
              ? {
                  id: latestStage.id,
                  processingCount: latestStage.processingCount,
                  status: statusForLatestStage,
                  processMethod: latestStage.processMethod,
                  dateOfProcessing: latestStage.dateOfProcessing,
                  doneBy: latestStage.doneBy,
                  initialQuantity: latestStage.initialQuantity,
                  quantityAfterProcess: latestStage.quantityAfterProcess,
                  lastDryingQuantity:
                    latestStage.dryingEntries[0]?.currentQuantity ?? null,
                }
              : null,
            totalQuantitySoldFromBatch: totalQuantitySoldFromBatchOverall,
            netAvailableQuantity: netAvailableFromLatestStage,
          };
        });

        const statusFilteredBatches = query.status
          ? transformedBatches.filter(
              (b) => b.latestStageSummary?.status === query.status,
            )
          : transformedBatches;

        const finalTotalCount = statusFilteredBatches.length;
        const paginatedBatches = statusFilteredBatches.slice(
          skip,
          skip + limit,
        );

        const result = {
          processingBatches: paginatedBatches,
          pagination: {
            page,
            limit,
            totalCount: finalTotalCount,
            totalPages: Math.ceil(finalTotalCount / limit),
          },
        };
        await redisClient.set(cacheKey, JSON.stringify(result), "EX", 3600); 
        return result;
      } catch (error: any) {
        if (error.issues)
          return reply
            .status(400)
            .send({ error: "Invalid query parameters", details: error.issues });
        console.error("Get processing batches error:", error);
        return reply.status(500).send({ error: "Server error" });
      }
    },
  );

  fastify.get(
    "/:batchId",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { batchId } = request.params as { batchId: string };
      console.log(batchId);
      const id = parseInt(batchId);
      if (isNaN(id))
        return reply.status(400).send({ error: "Invalid Batch ID" });

      const cacheKey = `processing-batch:${id}`;
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          try {
            const parsedCached = JSON.parse(cached);
            const latestStageForCached = parsedCached.processingStages
              ?.slice()
              .sort(
                (a: any, b: any) => b.processingCount - a.processingCount,
              )[0];
            let effectiveStatusCached: ExtendedProcessingStageStatus =
              latestStageForCached ? latestStageForCached.status : "NO_STAGES";
            let netAvailableFromLatestStageCached = 0;

            if (latestStageForCached) {
              if (
                latestStageForCached.status ===
                PrismaProcessingStageStatus.IN_PROGRESS
              ) {
                netAvailableFromLatestStageCached =
                  latestStageForCached.dryingEntries
                    ?.slice()
                    .sort((a: any, b: any) => b.day - a.day)[0]
                    ?.currentQuantity ?? latestStageForCached.initialQuantity;
              } else if (
                latestStageForCached.status ===
                PrismaProcessingStageStatus.FINISHED
              ) {
                const salesFromThisStageCached =
                  latestStageForCached.sales?.reduce(
                    (sum: number, sale: any) => sum + sale.quantitySold,
                    0,
                  ) || 0;
                netAvailableFromLatestStageCached =
                  (latestStageForCached.quantityAfterProcess || 0) -
                  salesFromThisStageCached;
                if (netAvailableFromLatestStageCached <= 0)
                  effectiveStatusCached = "SOLD_OUT";
              } else if (
                latestStageForCached.status ===
                PrismaProcessingStageStatus.CANCELLED
              ) {
                // No need to set to 0 as it's already initialized
              }
              parsedCached.netAvailableQuantity =
                netAvailableFromLatestStageCached; 
              if (parsedCached.latestStageSummary) {
                parsedCached.latestStageSummary.status = effectiveStatusCached;
              } else if (latestStageForCached) {
                parsedCached.latestStageSummary = {
                  id: latestStageForCached.id,
                  processingCount: latestStageForCached.processingCount,
                  status: effectiveStatusCached,
                  processMethod: latestStageForCached.processMethod,
                  dateOfProcessing: latestStageForCached.dateOfProcessing,
                  doneBy: latestStageForCached.doneBy,
                  initialQuantity: latestStageForCached.initialQuantity,
                  quantityAfterProcess:
                    latestStageForCached.quantityAfterProcess,
                  lastDryingQuantity:
                    latestStageForCached.dryingEntries
                      ?.slice()
                      .sort((a: any, b: any) => b.day - a.day)[0]
                      ?.currentQuantity ?? null,
                };
              }
            } else {
              parsedCached.netAvailableQuantity = 0;
            }
            return parsedCached;
          } catch (e) {
            console.warn(
              "Error parsing or re-evaluating cache for batch detail, fetching fresh.",
              e,
            );
          }
        }

        const batchFromDb = await prisma.processingBatch.findUnique({
          where: { id },
          include: {
            procurements: {
              include: { farmer: { select: { name: true, village: true } } },
            },
            processingStages: {
              include: {
                dryingEntries: { orderBy: { day: "asc" } },
                sales: {
                  select: { id: true, quantitySold: true, dateOfSale: true },
                },
              },
              orderBy: { processingCount: "asc" },
            },
            sales: {
              orderBy: { dateOfSale: "desc" },
              include: {
                processingStage: { select: { processingCount: true } },
              },
            },
            createdBy: { select: { id: true, name: true } },
          },
        });

        if (!batchFromDb)
          return reply
            .status(404)
            .send({ error: "Processing batch not found" });

        const sortedStages = [...batchFromDb.processingStages].sort(
          (a, b) => b.processingCount - a.processingCount,
        );
        const latestStageData = sortedStages[0];

        let netAvailableFromLatestStageQty: number = 0;
        let effectiveStatusForLatestStage: ExtendedProcessingStageStatus =
          "NO_STAGES";
        let latestStageSummaryData = null;

        if (latestStageData) {
          effectiveStatusForLatestStage = latestStageData.status;
          if (
            latestStageData.status === PrismaProcessingStageStatus.IN_PROGRESS
          ) {
            const latestDrying = latestStageData.dryingEntries.sort(
              (a, b) => b.day - a.day,
            )[0];
            netAvailableFromLatestStageQty =
              latestDrying?.currentQuantity ?? latestStageData.initialQuantity;
          } else if (
            latestStageData.status === PrismaProcessingStageStatus.FINISHED
          ) {
            const salesFromThisStage = latestStageData.sales.reduce(
              (sum, sale) => sum + sale.quantitySold,
              0,
            );
            netAvailableFromLatestStageQty =
              (latestStageData.quantityAfterProcess ?? 0) - salesFromThisStage;
            if (netAvailableFromLatestStageQty <= 0) {
              effectiveStatusForLatestStage = "SOLD_OUT";
            }
          } else if (
            latestStageData.status === PrismaProcessingStageStatus.CANCELLED
          ) {
            // No need to set to 0 as it's already initialized
          }

          latestStageSummaryData = {
            id: latestStageData.id,
            processingCount: latestStageData.processingCount,
            status: effectiveStatusForLatestStage,
            processMethod: latestStageData.processMethod,
            dateOfProcessing: latestStageData.dateOfProcessing,
            doneBy: latestStageData.doneBy,
            initialQuantity: latestStageData.initialQuantity,
            quantityAfterProcess: latestStageData.quantityAfterProcess,
            lastDryingQuantity:
              latestStageData.dryingEntries.sort((a, b) => b.day - a.day)[0]
                ?.currentQuantity ?? null,
          };
        } else {
          netAvailableFromLatestStageQty = 0;
        }

        const totalQuantitySoldFromBatchOverall = batchFromDb.sales.reduce(
          (sum, sale) => sum + sale.quantitySold,
          0,
        );

        const batchWithDetails = {
          ...batchFromDb,
          totalQuantitySoldFromBatch: totalQuantitySoldFromBatchOverall,
          netAvailableQuantity: netAvailableFromLatestStageQty,
          latestStageSummary: latestStageSummaryData,
        };

        await redisClient.set(
          cacheKey,
          JSON.stringify(batchWithDetails),
          "EX",
          3600,
        );
        return batchWithDetails;
      } catch (error) {
        console.error(`Error fetching batch ${id}:`, error);
        return reply.status(500).send({ error: "Server error" });
      }
    },
  );

  fastify.delete(
    "/:batchId",
    { preHandler: [verifyAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { batchId } = request.params as { batchId: string };
      const id = parseInt(batchId);
      if (isNaN(id))
        return reply.status(400).send({ error: "Invalid Batch ID" });

      try {
        const batch = await prisma.processingBatch.findUnique({
          where: { id },
        });
        if (!batch)
          return reply
            .status(404)
            .send({ error: "Processing batch not found." });

        await prisma.$transaction(async (tx) => {
          await tx.procurement.updateMany({
            where: { processingBatchId: id },
            data: { processingBatchId: null },
          });
          await tx.processingBatch.delete({ where: { id } });
        });

        await invalidateProcessingCache(id);
        return {
          success: true,
          message: `Processing batch ${batch.batchCode} deleted.`,
        };
      } catch (error) {
        console.error(`Error deleting batch ${id}:`, error);
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return reply
            .status(404)
            .send({ error: "Processing batch not found or already deleted." });
        }
        return reply
          .status(500)
          .send({ error: "Server error deleting batch." });
      }
    },
  );

  return fastify;
}

export default processingBatchRoutes;
