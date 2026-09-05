import fs from "fs/promises";
import path from "path";

import { config as scrapingConfig } from "@/config/scrapping";
import { config as parsingConfig } from "@/config/parsing";

const writeJson = async <T>(
  directory: string,
  filename: string,
  data: T,
): Promise<string> => {
  await fs.mkdir(directory, {
    recursive: true,
  });

  const outputPath = path.join(directory, filename);

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");

  return outputPath;
};

export const writeRawData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(scrapingConfig.storage.rawDataDir, `${filename}.json`, data);
};

export const writeNormData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    scrapingConfig.storage.normDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeOfferingData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.offeringDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeNotOfferingData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.notOfferingDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeSeekingData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.seekingDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeAmbiguousData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.ambiguousDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeNotHousingData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.notHousingDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeClassifiedData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.classifiedDataDir,
    `${filename}.json`,
    data,
  );
};

export const writeFinalData = async <T>(
  filename: string,
  data: T,
): Promise<string> => {
  return writeJson(
    parsingConfig.storage.finalDataDir,
    `${filename}.json`,
    data,
  );
};
