import { Note } from './Note';
import { NoteQuestionParser } from './NoteQuestionParser';
import { Question } from './Question';
import { ISRFile } from './SRFile';
import { TopicPath } from './TopicPath';
import { SRSettings } from './interfaces';

export class NoteFileLoader {
	fileText: string;
	fixesMade: boolean;
	noteTopicPath: TopicPath;
	noteFile: ISRFile;
	settings: SRSettings;

	constructor(settings: SRSettings) {
		this.settings = settings;
	}

	async load(noteFile: ISRFile, noteTopicPath: TopicPath): Promise<Note> {
		this.noteFile = noteFile;

		const questionParser: NoteQuestionParser = new NoteQuestionParser(
			this.settings,
		);

		const questionList: Question[] =
			await questionParser.createQuestionList(noteFile, noteTopicPath);

		const result: Note = new Note(noteFile, questionList);
		return result;
	}
}
