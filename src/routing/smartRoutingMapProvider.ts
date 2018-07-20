import * as assert from "assert";
import { Constants } from "../common";
import { PartitionKeyRangeCache, QueryRange } from "./";

export const PARITIONKEYRANGE = Constants.PartitionKeyRange;

export class SmartRoutingMapProvider {
  private partitionKeyRangeCache: PartitionKeyRangeCache;
  /**
   * Represents a SmartRoutingMapProvider Object,
   * Efficiently uses PartitionKeyRangeCache and minimizes the unnecessary
   * invocation of PartitionKeyRangeCache.getOverlappingRanges()
   * @constructor SmartRoutingMapProvider
   * @param {object} documentclient                - The documentclient object.
   * @ignore
   */
  constructor(documentclient: any) {
    // TODO: documentclient any
    this.partitionKeyRangeCache = new PartitionKeyRangeCache(documentclient);
  }
  private static _secondRangeIsAfterFirstRange(range1: QueryRange, range2: QueryRange) {
    assert.notEqual(range1.max, undefined, "invalid arg");
    assert.notEqual(range2.min, undefined, "invalid arg");

    if (range1.max > range2.min) {
      // r.min < #previous_r.max
      return false;
    } else {
      if (range1.max === range2.min && range1.isMaxInclusive && range2.isMinInclusive) {
        // the inclusive ending endpoint of previous_r is the same as the inclusive beginning endpoint of r
        // they share a point
        return false;
      }
      return true;
    }
  }

  private static _isSortedAndNonOverlapping(ranges: QueryRange[]) {
    for (let idx = 1; idx < ranges.length; idx++) {
      const previousR = ranges[idx - 1];
      const r = ranges[idx];
      if (!this._secondRangeIsAfterFirstRange(previousR, r)) {
        return false;
      }
    }
    return true;
  }

  private static _stringMax(a: string, b: string) {
    return a >= b ? a : b;
  }

  private static _stringCompare(a: string, b: string) {
    return a === b ? 0 : a > b ? 1 : -1;
  }

  private static _subtractRange(r: QueryRange, partitionKeyRange: any) {
    const left = this._stringMax(partitionKeyRange[PARITIONKEYRANGE.MaxExclusive], r.min);
    const leftInclusive = this._stringCompare(left, r.min) === 0 ? r.isMinInclusive : false;
    return new QueryRange(left, r.max, leftInclusive, r.isMaxInclusive);
  }

  /**
   * Given the sorted ranges and a collection, invokes the callback on the list of overlapping partition key ranges
   * @param {callback} callback - Function execute on the overlapping partition key ranges result,
   *                              takes two parameters error, partition key ranges
   * @param collectionLink
   * @param sortedRanges
   * @ignore
   */
  public async getOverlappingRanges(collectionLink: string, sortedRanges: QueryRange[]): Promise<any[]> {
    // validate if the list is non- overlapping and sorted                             TODO: any PartitionKeyRanges
    if (!SmartRoutingMapProvider._isSortedAndNonOverlapping(sortedRanges)) {
      throw new Error("the list of ranges is not a non-overlapping sorted ranges");
    }

    let partitionKeyRanges: any[] = []; // TODO: any ParitionKeyRanges

    if (sortedRanges.length === 0) {
      return partitionKeyRanges;
    }

    const collectionRoutingMap = await this.partitionKeyRangeCache.onCollectionRoutingMap(collectionLink);

    let index = 0;
    let currentProvidedRange = sortedRanges[index];
    while (true) {
      if (currentProvidedRange.isEmpty()) {
        // skip and go to the next item
        if (++index >= sortedRanges.length) {
          return partitionKeyRanges;
        }
        currentProvidedRange = sortedRanges[index];
        continue;
      }

      let queryRange;
      if (partitionKeyRanges.length > 0) {
        queryRange = SmartRoutingMapProvider._subtractRange(
          currentProvidedRange,
          partitionKeyRanges[partitionKeyRanges.length - 1]
        );
      } else {
        queryRange = currentProvidedRange;
      }

      const overlappingRanges = collectionRoutingMap.getOverlappingRanges(queryRange);
      assert.ok(
        overlappingRanges.length > 0,
        `error: returned overlapping ranges for queryRange ${queryRange} is empty`
      );
      partitionKeyRanges = partitionKeyRanges.concat(overlappingRanges);

      const lastKnownTargetRange = QueryRange.parsePartitionKeyRange(partitionKeyRanges[partitionKeyRanges.length - 1]);
      assert.notEqual(lastKnownTargetRange, undefined);
      // the overlapping ranges must contain the requested range
      assert.ok(
        SmartRoutingMapProvider._stringCompare(currentProvidedRange.max, lastKnownTargetRange.max) <= 0,
        `error: returned overlapping ranges ${overlappingRanges} \
                    does not contain the requested range ${queryRange}`
      );

      // the current range is contained in partitionKeyRanges just move forward
      if (++index >= sortedRanges.length) {
        return partitionKeyRanges;
      }
      currentProvidedRange = sortedRanges[index];

      while (SmartRoutingMapProvider._stringCompare(currentProvidedRange.max, lastKnownTargetRange.max) <= 0) {
        // the current range is covered too.just move forward
        if (++index >= sortedRanges.length) {
          return partitionKeyRanges;
        }
        currentProvidedRange = sortedRanges[index];
      }
    }
  }
}