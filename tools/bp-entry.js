// Entry for the offline bundle: exposes window.BP = { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime, tf }
import * as tf from '@tensorflow/tfjs';
import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';
window.BP = { tf, BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime };
