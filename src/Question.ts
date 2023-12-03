import { Card } from './Card';
import { CardScheduleInfo } from './CardSchedule';
import { Note } from './Note';
import { QuestionText } from './QuestionText';
import { TopicPath } from './TopicPath';
import { SR_HTML_COMMENT_BEGIN, SR_HTML_COMMENT_END } from './constants';
import { CardType } from './enums';
import { SRSettings } from './interfaces';
import { MultiLineTextFinder } from './util/MultiLineTextFinder';

export class Question {
	note: Note;
	questionType: CardType;
	topicPath: TopicPath;
	questionText: QuestionText;
	lineNo: number;
	hasEditLaterTag: boolean;
	questionContext: string[];
	cards: Card[];
	hasChanged: boolean;

	constructor(init?: Partial<Question>) {
		Object.assign(this, init);
	}

	setCardList(cards: Card[]): void {
		this.cards = cards;
		this.cards.forEach((card) => (card.question = this));
	}

	updateQuestionText(noteText: string, settings: SRSettings): string {
		const originalText: string = this.questionText.original;

		// Get the entire text for the question including:
		//      1. the topic path (if present),
		//      2. the question text
		//      3. the schedule HTML comment (if present)
		const replacementText = this.formatForNote(settings);

		let newText = MultiLineTextFinder.findAndReplace(
			noteText,
			originalText,
			replacementText,
		);
		if (newText) {
			this.questionText = QuestionText.create(replacementText, settings);
		} else {
			console.error(
				`updateQuestionText: Text not found: ${originalText.substring(
					0,
					100,
				)} in note: ${noteText.substring(0, 100)}`,
			);
			newText = noteText;
		}
		return newText;
	}

	async writeQuestion(settings: SRSettings): Promise<void> {
		const fileText: string = await this.note.file.read();

		const newText: string = this.updateQuestionText(fileText, settings);
		await this.note.file.write(newText);
		this.hasChanged = false;
	}

	static Create(
		settings: SRSettings,
		questionType: CardType,
		noteTopicPath: TopicPath,
		originalText: string,
		lineNo: number,
		context: string[],
	): Question {
		const hasEditLaterTag = originalText.includes(settings.editLaterTag);
		const questionText: QuestionText = QuestionText.create(
			originalText,
			settings,
		);

		let topicPath: TopicPath = noteTopicPath;
		if (questionText.topicPath.hasPath) {
			topicPath = questionText.topicPath;
		}

		const result: Question = new Question({
			questionType,
			topicPath,
			questionText,
			lineNo,
			hasEditLaterTag,
			questionContext: context,
			cards: [],
			hasChanged: false,
		});

		return result;
	}

	private getHtmlCommentSeparator(settings: SRSettings): string {
		let sep: string = settings.cardCommentOnSameLine ? ' ' : '\n';
		// Override separator if last block is a codeblock
		if (this.questionText.endsWithCodeBlock() && sep !== '\n') {
			sep = '\n';
		}
		return sep;
	}

	private formatScheduleAsHtmlComment(settings: SRSettings): string {
		let result: string = SR_HTML_COMMENT_BEGIN;

		// We always want the correct schedule format, so we use this if there is no schedule for a card

		for (let i = 0; i < this.cards.length; i++) {
			const card: Card = this.cards[i];
			const schedule: CardScheduleInfo = card.hasSchedule
				? (card.scheduleInfo as CardScheduleInfo)
				: CardScheduleInfo.getDummyScheduleForNewCard(settings);
			result += schedule.formatSchedule();
		}
		result += SR_HTML_COMMENT_END;
		return result;
	}

	private formatForNote(settings: SRSettings): string {
		let result: string = this.questionText.formatForNote();
		if (this.cards.some((card) => card.hasSchedule)) {
			result +=
				this.getHtmlCommentSeparator(settings) +
				this.formatScheduleAsHtmlComment(settings);
		}
		return result;
	}
}