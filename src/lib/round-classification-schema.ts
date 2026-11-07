import { z } from "zod";
import { roundCategoryIds, roundSubcategoryIds, validRoundClassification } from "./round-classification";
export const roundClassificationFields = { category: z.enum(roundCategoryIds), subcategory: z.enum(roundSubcategoryIds) };
export const roundClassificationSchema = z.object(roundClassificationFields).refine(validRoundClassification, "Phân loại phụ không thuộc nhóm vòng luyện đã chọn.");
